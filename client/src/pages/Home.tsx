import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Image, InsertImage } from "@shared/schema";
import { UploadZone } from "@/components/UploadZone";
import { CameraCapture } from "@/components/CameraCapture";
import { ImageGallery } from "@/components/ImageGallery";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const { data: images = [], isLoading } = useQuery<Image[]>({
    queryKey: ["/api/images"],
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50">
        <div className="container max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">I</span>
            </div>
            <h1 className="text-xl font-bold" data-testid="text-app-title">ImageDrop</h1>
          </div>
          <div className="text-sm text-muted-foreground" data-testid="text-image-count">
            {images.length} {images.length === 1 ? "image" : "images"}
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
          <div className="flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-sm text-muted-foreground font-medium">
              Your Images
            </span>
            <Separator className="flex-1" />
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
    </div>
  );
}
