import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Image, InsertImage, Transcription } from "@shared/schema";
import { UploadZone } from "@/components/UploadZone";
import { CameraCapture } from "@/components/CameraCapture";
import { RecordingBar } from "@/components/RecordingBar";
import { ImageGallery } from "@/components/ImageGallery";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Trash2, FileText, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Home() {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState<number | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  const { data: imagesData = [], isLoading } = useQuery<Image[]>({
    queryKey: ["/api/images"],
    refetchInterval: 3000, // Auto-refresh every 3 seconds
  });

  const { data: transcriptionsData = [], isLoading: isLoadingTranscriptions } = useQuery<Transcription[]>({
    queryKey: ["/api/transcriptions"],
    refetchInterval: 3000, // Auto-refresh every 3 seconds
  });

  // Merge images and transcriptions into a chronological timeline
  type TimelineItem = 
    | { type: 'image'; data: Image }
    | { type: 'transcription'; data: Transcription };

  const timeline: TimelineItem[] = [
    ...imagesData.map(img => ({ type: 'image' as const, data: img })),
    ...transcriptionsData.map(trans => ({ type: 'transcription' as const, data: trans }))
  ].sort((a, b) => {
    const timeA = new Date(a.data.uploadedAt || a.data.createdAt).getTime();
    const timeB = new Date(b.data.uploadedAt || b.data.createdAt).getTime();
    return timeA - timeB; // oldest first
  });

  const uploadMutation = useMutation({
    mutationFn: async (imageData: InsertImage) => {
      return await apiRequest("POST", "/api/images", imageData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/images"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/images/${id}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/images"] });
      toast({
        title: "Image deleted",
        description: "Image has been removed from your gallery",
      });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", "/api/images", undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/images"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transcriptions"] });
      setDeleteAllDialogOpen(false);
      toast({
        title: "All content deleted",
        description: "Your gallery and transcriptions have been cleared",
      });
    },
    onError: () => {
      toast({
        title: "Delete failed",
        description: "Could not delete content. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = async (files: File[]) => {
    setIsUploading(true);

    try {
      for (const file of files) {
        const uploadUrlRes = await apiRequest(
          "POST",
          "/api/objects/upload",
          undefined
        );
        const uploadUrlData = await uploadUrlRes.json() as { uploadURL: string };

        await fetch(uploadUrlData.uploadURL, {
          method: "PUT",
          body: file,
          headers: {
            "Content-Type": file.type,
          },
        });

        const url = new URL(uploadUrlData.uploadURL);
        const objectId = url.pathname.split("/").pop()?.split("?")[0] || "";

        const imageData: InsertImage = {
          id: objectId,
          objectPath: `/objects/uploads/${objectId}`,
          fileName: file.name,
          fileSize: formatFileSize(file.size),
          mimeType: file.type,
        };

        await uploadMutation.mutateAsync(imageData);

        const fullUrl = `${window.location.origin}${imageData.objectPath}`;
        await navigator.clipboard.writeText(fullUrl);

        toast({
          title: "Image uploaded!",
          description: "Link copied to clipboard",
        });
      }
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handleSelectAllTimestamps = () => {
    const selection = window.getSelection();
    const range = document.createRange();
    
    // Find the timeline container
    const timelineContainer = document.querySelector('[data-testid="timeline-container"]');
    
    if (!timelineContainer) return;
    
    const firstElement = timelineContainer.firstElementChild;
    const lastElement = timelineContainer.lastElementChild;
    
    if (firstElement && lastElement) {
      range.setStartBefore(firstElement);
      range.setEndAfter(lastElement);
      selection?.removeAllRanges();
      selection?.addRange(range);
      
      toast({
        title: "Text selected",
        description: "Press Ctrl+C to copy, then auto-delete starts",
      });
    }
  };

  const startDeleteCountdown = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    
    setDeleteCountdown(10);
    
    const interval = setInterval(() => {
      setDeleteCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          deleteAllMutation.mutate();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    
    countdownTimerRef.current = interval;
  };

  const cancelDeleteCountdown = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setDeleteCountdown(null);
    toast({
      title: "Auto-delete cancelled",
      description: "Your images are safe",
    });
  };

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      const selection = window.getSelection();
      const selectedText = selection?.toString();
      
      // Check if any timestamp text from images is being copied
      if (selectedText && selectedText.includes('image.png')) {
        // Add a small delay to ensure clipboard operation completes
        setTimeout(() => {
          startDeleteCountdown();
        }, 200);
      }
    };

    document.addEventListener("copy", handleCopy);
    return () => {
      document.removeEventListener("copy", handleCopy);
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (deleteCountdown === null && countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, [deleteCountdown]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50">
        <div className="container max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">I</span>
            </div>
            <h1 className="text-xl font-bold" data-testid="text-app-title">ImageDrop</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-muted-foreground" data-testid="text-image-count">
              {timeline.length} {timeline.length === 1 ? "item" : "items"}
            </div>
            {timeline.length > 0 && (
              <Button
                variant={deleteCountdown !== null ? "outline" : "destructive"}
                size="sm"
                onClick={() => {
                  if (deleteCountdown !== null) {
                    cancelDeleteCountdown();
                  } else {
                    setDeleteAllDialogOpen(true);
                  }
                }}
                data-testid="button-delete-all"
              >
                {deleteCountdown !== null ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Cancel ({deleteCountdown}s)
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete All
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-8">
        {/* Upload Zone */}
        <UploadZone
          onFileSelect={handleFileUpload}
          onOpenCamera={() => setCameraOpen(true)}
          isUploading={isUploading}
        />

        {/* Separator */}
        {timeline.length > 0 && (
          <div className="flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-sm text-muted-foreground font-medium">
              Timeline
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSelectAllTimestamps}
              data-testid="button-select-all"
            >
              <FileText className="w-4 h-4 mr-2" />
              Select All
            </Button>
            <Separator className="flex-1" />
          </div>
        )}

        {/* Timeline */}
        {isLoading || isLoadingTranscriptions ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" data-testid="loading-spinner" />
          </div>
        ) : (
          <div className="space-y-4" data-testid="timeline-container">
            {timeline.map((item) => {
              if (item.type === 'image') {
                return (
                  <div 
                    key={`image-${item.data.id}`}
                    className="bg-card rounded-lg border overflow-hidden"
                    data-testid={`card-image-${item.data.id}`}
                  >
                    <img
                      src={item.data.objectPath}
                      alt={item.data.fileName}
                      className="w-full h-auto"
                      loading="lazy"
                    />
                    <div className="p-4">
                      <p className="text-sm font-medium">{item.data.fileName}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(item.data.uploadedAt).toLocaleDateString()} {new Date(item.data.uploadedAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                );
              } else {
                return (
                  <div 
                    key={`transcription-${item.data.id}`}
                    className="p-4 bg-muted/30 rounded-lg border"
                    data-testid={`transcription-${item.data.id}`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{item.data.text}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(item.data.createdAt).toLocaleDateString()} {new Date(item.data.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                );
              }
            })}
          </div>
        )}
      </main>

      {/* Camera Modal */}
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => handleFileUpload([file])}
      />

      {/* Recording Bar */}
      <RecordingBar
        onTranscribed={() => queryClient.invalidateQueries({ queryKey: ["/api/transcriptions"] })}
      />

      {/* Delete All Confirmation Dialog */}
      <AlertDialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-all">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete everything?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {timeline.length} {timeline.length === 1 ? "item" : "items"} (images and transcriptions) from your timeline.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              disabled={deleteAllMutation.isPending}
              data-testid="button-cancel-delete-all"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteAllMutation.mutate();
              }}
              disabled={deleteAllMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-all"
            >
              {deleteAllMutation.isPending ? "Deleting..." : "Delete All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Add padding at bottom to account for RecordingBar */}
      <div className="h-20" />
    </div>
  );
}
