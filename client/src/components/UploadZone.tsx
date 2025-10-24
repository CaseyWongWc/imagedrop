import { useCallback, useEffect, useState } from "react";
import { Upload, Image as ImageIcon, Camera, Clipboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface UploadZoneProps {
  onFileSelect: (files: File[]) => void;
  onOpenCamera: () => void;
  isUploading?: boolean;
}

export function UploadZone({ onFileSelect, onOpenCamera, isUploading }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith("image/")
    );

    if (files.length > 0) {
      onFileSelect(files);
    } else {
      toast({
        title: "Invalid files",
        description: "Please drop image files only",
        variant: "destructive",
      });
    }
  }, [onFileSelect, toast]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFileSelect(files);
    }
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      onFileSelect(files);
      toast({
        title: "Image pasted",
        description: "Image from clipboard is being uploaded",
      });
    }
  }, [onFileSelect, toast]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  return (
    <Card
      className={`border-2 border-dashed transition-all ${
        isDragging
          ? "border-primary bg-primary/5 scale-[1.02]"
          : "border-border hover-elevate"
      } ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      data-testid="upload-zone"
    >
      <div className="p-8 md:p-12 text-center space-y-6">
        {/* Mobile-optimized camera button - prominent and easy to tap */}
        <button
          onClick={onOpenCamera}
          disabled={isUploading}
          className="mx-auto w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center hover-elevate active-elevate-2 transition-transform disabled:opacity-50"
          data-testid="button-camera-main"
        >
          <Camera className="w-10 h-10 text-primary" />
        </button>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold">
            {isUploading ? "Uploading..." : "Upload Your Images"}
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Drop images here, paste from clipboard (Ctrl+V), or choose an option below
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="default"
            onClick={() => document.getElementById("file-input")?.click()}
            disabled={isUploading}
            data-testid="button-browse"
          >
            <ImageIcon className="w-4 h-4 mr-2" />
            Browse Files
          </Button>

          <Button
            variant="outline"
            disabled={isUploading}
            data-testid="button-paste-hint"
          >
            <Clipboard className="w-4 h-4 mr-2" />
            Paste (Ctrl+V)
          </Button>
        </div>

        <input
          id="file-input"
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileInput}
          data-testid="input-file"
        />

        <div className="text-xs text-muted-foreground">
          Supports PNG, JPG, GIF, WebP • Max 10MB per file
        </div>
      </div>
    </Card>
  );
}
