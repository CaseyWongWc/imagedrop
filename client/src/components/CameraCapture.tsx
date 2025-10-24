import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Camera, X, RefreshCw, Zap, RotateCw } from "lucide-react";
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
  const [continuousMode, setContinuousMode] = useState(() => {
    // Load saved preference from localStorage
    const saved = localStorage.getItem("camera-continuous-mode");
    return saved === "true";
  });
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(() => {
    // Load saved preference from localStorage
    const saved = localStorage.getItem("camera-orientation");
    return (saved === "landscape" ? "landscape" : "portrait") as "portrait" | "landscape";
  });
  const { toast } = useToast();

  // Save orientation preference to localStorage
  useEffect(() => {
    localStorage.setItem("camera-orientation", orientation);
  }, [orientation]);

  // Save continuous mode preference to localStorage
  useEffect(() => {
    localStorage.setItem("camera-continuous-mode", continuousMode.toString());
  }, [continuousMode]);

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

  const capturePhoto = async () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    
    // Apply rotation based on orientation preference
    if (orientation === "landscape") {
      // Rotate 90 degrees clockwise for landscape
      canvas.width = video.videoHeight;
      canvas.height = video.videoWidth;
    } else {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    if (orientation === "landscape") {
      // Rotate the canvas context 90 degrees clockwise
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
    } else {
      ctx.drawImage(video, 0, 0);
    }
    
    const dataUrl = canvas.toDataURL("image/png");
    
    if (continuousMode) {
      // Auto-upload in continuous mode - stay on camera
      try {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], `camera-${Date.now()}.png`, { type: "image/png" });
        onCapture(file);
        toast({
          title: "Photo captured!",
          description: "Uploading in background",
        });
      } catch (error) {
        toast({
          title: "Capture failed",
          description: "Please try again",
          variant: "destructive",
        });
      }
    } else {
      // Normal mode - show preview
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
      <DialogContent className="max-w-2xl w-[95vw] md:w-full" data-testid="dialog-camera">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Take Photo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Camera Settings */}
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-muted-foreground" />
                <Label htmlFor="continuous-mode" className="cursor-pointer">
                  Continuous Capture
                </Label>
              </div>
              <Switch
                id="continuous-mode"
                checked={continuousMode}
                onCheckedChange={setContinuousMode}
                data-testid="switch-continuous-mode"
              />
            </div>
            
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <RotateCw className="w-4 h-4 text-muted-foreground" />
                <Label htmlFor="orientation-mode" className="cursor-pointer">
                  Sideways (Landscape)
                </Label>
              </div>
              <Switch
                id="orientation-mode"
                checked={orientation === "landscape"}
                onCheckedChange={(checked) => setOrientation(checked ? "landscape" : "portrait")}
                data-testid="switch-orientation"
              />
            </div>
          </div>
          <div className="relative w-full bg-muted rounded-lg overflow-hidden aspect-video md:aspect-video">
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
