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
import { Trash2, FileText, Loader2, Settings } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import heic2any from "heic2any";

export default function Home() {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState<number | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Settings with localStorage persistence
  const [autoDeleteEnabled, setAutoDeleteEnabled] = useState(() => {
    const saved = localStorage.getItem("auto-delete-enabled");
    return saved === "true";
  });
  const [autoDeleteTimer, setAutoDeleteTimer] = useState(() => {
    const saved = localStorage.getItem("auto-delete-timer");
    return saved ? parseInt(saved) : 10;
  });
  
  const { toast } = useToast();

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem("auto-delete-enabled", autoDeleteEnabled.toString());
  }, [autoDeleteEnabled]);

  useEffect(() => {
    localStorage.setItem("auto-delete-timer", autoDeleteTimer.toString());
  }, [autoDeleteTimer]);

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
    const timeA = a.type === 'image' ? new Date(a.data.uploadedAt).getTime() : new Date(a.data.createdAt).getTime();
    const timeB = b.type === 'image' ? new Date(b.data.uploadedAt).getTime() : new Date(b.data.createdAt).getTime();
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

  const convertHeicToPng = async (file: File): Promise<File> => {
    const isHeic = file.name.toLowerCase().endsWith('.heic') || 
                   file.name.toLowerCase().endsWith('.heif') ||
                   file.type === 'image/heic' ||
                   file.type === 'image/heif';
    
    if (!isHeic) {
      return file;
    }

    try {
      const convertedBlob = await heic2any({
        blob: file,
        toType: "image/png",
        quality: 0.9,
      });

      const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
      const newFileName = file.name.replace(/\.heic$/i, '.png').replace(/\.heif$/i, '.png');
      
      return new File([blob], newFileName, {
        type: "image/png",
        lastModified: Date.now(),
      });
    } catch (error) {
      console.error("HEIC conversion error:", error);
      throw new Error("Failed to convert HEIC/HEIF file");
    }
  };

  const handleFileUpload = async (files: File[]) => {
    setIsUploading(true);

    try {
      for (const file of files) {
        let processedFile = file;
        
        try {
          processedFile = await convertHeicToPng(file);
        } catch (conversionError) {
          toast({
            title: "Conversion failed",
            description: "Could not convert HEIC/HEIF file. Please try a different format.",
            variant: "destructive",
          });
          continue;
        }

        const uploadUrlRes = await apiRequest(
          "POST",
          "/api/objects/upload",
          undefined
        );
        const uploadUrlData = await uploadUrlRes.json() as { uploadURL: string };

        await fetch(uploadUrlData.uploadURL, {
          method: "PUT",
          body: processedFile,
          headers: {
            "Content-Type": processedFile.type,
          },
        });

        const url = new URL(uploadUrlData.uploadURL);
        const objectId = url.pathname.split("/").pop()?.split("?")[0] || "";

        const imageData: InsertImage = {
          id: objectId,
          objectPath: `/objects/uploads/${objectId}`,
          fileName: processedFile.name,
          fileSize: formatFileSize(processedFile.size),
          mimeType: processedFile.type,
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
        description: autoDeleteEnabled ? `Press Ctrl+C to copy, auto-delete in ${autoDeleteTimer}s` : "Press Ctrl+C to copy",
      });
    }
  };

  const startDeleteCountdown = () => {
    if (!autoDeleteEnabled) return; // Don't start countdown if disabled
    
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    
    setDeleteCountdown(autoDeleteTimer);
    
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
  }, [autoDeleteEnabled, autoDeleteTimer]);

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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              data-testid="button-settings"
            >
              <Settings className="w-4 h-4" />
            </Button>
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

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent data-testid="dialog-settings">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Customize your ImageDrop experience
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Auto-delete toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="auto-delete-toggle">Auto-delete after copy</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically delete all images after copying text
                </p>
              </div>
              <Switch
                id="auto-delete-toggle"
                checked={autoDeleteEnabled}
                onCheckedChange={setAutoDeleteEnabled}
                data-testid="switch-auto-delete"
              />
            </div>

            {/* Timer duration selector */}
            {autoDeleteEnabled && (
              <div className="space-y-2">
                <Label htmlFor="timer-select">Auto-delete timer</Label>
                <Select
                  value={autoDeleteTimer.toString()}
                  onValueChange={(value) => setAutoDeleteTimer(parseInt(value))}
                >
                  <SelectTrigger id="timer-select" data-testid="select-timer">
                    <SelectValue placeholder="Select timer duration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 seconds</SelectItem>
                    <SelectItem value="10">10 seconds</SelectItem>
                    <SelectItem value="15">15 seconds</SelectItem>
                    <SelectItem value="30">30 seconds</SelectItem>
                    <SelectItem value="60">1 minute</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  How long before auto-delete starts after copying
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add padding at bottom to account for RecordingBar */}
      <div className="h-20" />
    </div>
  );
}
