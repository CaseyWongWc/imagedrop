import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, X, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export function CameraCapture({ open, onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const { toast } = useToast();

  useEffect(() => {
    let currentStream: MediaStream | null = null;

    const startCamera = async () => {
      if (!open || captured) return;

      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false,
        });

        currentStream = mediaStream;
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (error) {
        toast({
          title: "Camera Error",
          description: "Unable to access camera. Please check permissions.",
          variant: "destructive",
        });
      }
    };

    startCamera();
    
    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [open, facingMode, captured, toast]);

  const handleClose = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setCaptured(null);
    onClose();
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      setCaptured(dataUrl);
    }
  };

  const usePhoto = () => {
    if (!captured) return;

    fetch(captured)
      .then(res => res.blob())
      .then(blob => {
        const file = new File([blob], `camera-${Date.now()}.png`, { type: "image/png" });
        onCapture(file);
        handleClose();
      });
  };

  const retake = () => {
    setCaptured(null);
  };

  const switchCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    const newMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newMode);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-camera">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Take Photo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
            {!captured ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
                data-testid="video-camera"
              />
            ) : (
              <img
                src={captured}
                alt="Captured"
                className="w-full h-full object-cover"
                data-testid="img-preview"
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            {!captured ? (
              <>
                <Button
                  variant="outline"
                  onClick={handleClose}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  size="lg"
                  onClick={capturePhoto}
                  className="flex-1 max-w-xs"
                  data-testid="button-capture"
                >
                  <Camera className="w-5 h-5 mr-2" />
                  Capture
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={switchCamera}
                  data-testid="button-switch-camera"
                >
                  <RefreshCw className="w-5 h-5" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={retake}
                  data-testid="button-retake"
                >
                  Retake
                </Button>
                <Button
                  onClick={usePhoto}
                  className="flex-1 max-w-xs"
                  data-testid="button-use-photo"
                >
                  Use Photo
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
