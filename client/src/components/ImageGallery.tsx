import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Trash2, Check, ExternalLink } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Image } from "@shared/schema";
import { LinkCopyField } from "./LinkCopyField";

interface ImageGalleryProps {
  images: Image[];
  onDelete?: (id: string) => void;
}

export function ImageGallery({ images, onDelete }: ImageGalleryProps) {
  const [selectedImage, setSelectedImage] = useState<Image | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const getImageUrl = (image: Image) => {
    return `${window.location.origin}${image.objectPath}`;
  };

  const copyLink = async (image: Image, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(getImageUrl(image));
      setCopiedId(image.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(id);
    }
  };

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-gallery">
        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-4">
          <ExternalLink className="w-10 h-10 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No images yet</h3>
        <p className="text-muted-foreground max-w-md">
          Upload your first image by dragging and dropping, pasting, or using the camera above
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {images.map((image) => (
          <Card
            key={image.id}
            className="group relative overflow-hidden hover-elevate active-elevate-2 cursor-pointer"
            onClick={() => setSelectedImage(image)}
            data-testid={`card-image-${image.id}`}
          >
            <div className="aspect-square bg-muted">
              <img
                src={getImageUrl(image)}
                alt={image.fileName}
                className="w-full h-full object-cover"
                data-testid={`img-thumbnail-${image.id}`}
              />
            </div>

            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <Button
                size="icon"
                variant="secondary"
                onClick={(e) => copyLink(image, e)}
                data-testid={`button-copy-${image.id}`}
              >
                {copiedId === image.id ? (
                  <Check className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
              {onDelete && (
                <Button
                  size="icon"
                  variant="destructive"
                  onClick={(e) => handleDelete(image.id, e)}
                  data-testid={`button-delete-${image.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            {/* Image info */}
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-2 text-white text-xs font-mono opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="truncate">{image.fileName}</div>
              <div className="text-white/70">{image.fileSize}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Lightbox */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-4xl" data-testid="dialog-lightbox">
          {selectedImage && (
            <div className="space-y-4">
              <div className="relative bg-muted rounded-lg overflow-hidden">
                <img
                  src={getImageUrl(selectedImage)}
                  alt={selectedImage.fileName}
                  className="w-full max-h-[70vh] object-contain"
                  data-testid="img-lightbox"
                />
              </div>

              <div className="space-y-4">
                <LinkCopyField url={getImageUrl(selectedImage)} />
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">File Name</div>
                    <div className="font-medium truncate" data-testid="text-filename">{selectedImage.fileName}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">File Size</div>
                    <div className="font-medium" data-testid="text-filesize">{selectedImage.fileSize}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Type</div>
                    <div className="font-medium" data-testid="text-mimetype">{selectedImage.mimeType}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Uploaded</div>
                    <div className="font-medium" data-testid="text-uploaded">
                      {new Date(selectedImage.uploadedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
