import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Image, InsertImage } from "@shared/schema";
import { UploadZone } from "@/components/UploadZone";
import { CameraCapture } from "@/components/CameraCapture";
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
  const timestampsRef = useRef<HTMLDivElement>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  const { data: imagesData = [], isLoading } = useQuery<Image[]>({
    queryKey: ["/api/images"],
    refetchInterval: 3000, // Auto-refresh every 3 seconds
  });

  const images = [...imagesData].reverse();

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
      setDeleteAllDialogOpen(false);
      toast({
        title: "All images deleted",
        description: "Your gallery has been cleared",
      });
    },
    onError: () => {
      toast({
        title: "Delete failed",
        description: "Could not delete all images. Please try again.",
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
    if (timestampsRef.current) {
      const range = document.createRange();
      range.selectNodeContents(timestampsRef.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      
      toast({
        title: "Text selected",
        description: "Press Ctrl+C to copy, then images will auto-delete",
      });
    }
  };

  const startDeleteCountdown = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    
    setDeleteCountdown(2);
    
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
      if (selection && timestampsRef.current?.contains(selection.anchorNode)) {
        startDeleteCountdown();
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
              {images.length} {images.length === 1 ? "image" : "images"}
            </div>
            {images.length > 0 && (
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
        {images.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Separator className="flex-1" />
              <span className="text-sm text-muted-foreground font-medium">
                Your Images
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
            
            {/* Timestamps text area */}
            <div 
              ref={timestampsRef}
              className="text-xs text-muted-foreground space-y-1 select-text"
              data-testid="text-timestamps"
            >
              {images.map((image) => (
                <div key={image.id}>
                  {image.fileName} - {new Date(image.uploadedAt).toLocaleDateString()} {new Date(image.uploadedAt).toLocaleTimeString()}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Gallery */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" data-testid="loading-spinner" />
          </div>
        ) : (
          <ImageGallery
            images={images}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        )}
      </main>

      {/* Camera Modal */}
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => handleFileUpload([file])}
      />

      {/* Delete All Confirmation Dialog */}
      <AlertDialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-all">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all images?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {images.length} {images.length === 1 ? "image" : "images"} from your gallery.
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
    </div>
  );
}
