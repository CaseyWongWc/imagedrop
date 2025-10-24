import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AudioRecorderProps {
  open: boolean;
  onClose: () => void;
  onTranscribed: () => void;
}

export function AudioRecorder({ open, onClose, onTranscribed }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const segmentTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  // Automatic segmentation every 30 seconds for continuous recording
  const SEGMENT_DURATION = 30000;

  useEffect(() => {
    if (open && !isRecording) {
      startRecording();
    }
    
    return () => {
      stopRecording();
      if (timerRef.current) clearInterval(timerRef.current);
      if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
    };
  }, [open]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        await transcribeAudio(audioBlob);
        chunksRef.current = [];
        
        // Continue recording if dialog is still open
        if (open && mediaRecorderRef.current?.state !== "recording") {
          startRecording();
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      // Auto-segment after 30 seconds
      segmentTimerRef.current = setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          mediaRecorder.stop();
        }
      }, SEGMENT_DURATION);

    } catch (error) {
      toast({
        title: "Microphone Error",
        description: "Unable to access microphone. Please check permissions.",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsTranscribing(true);
    
    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      
      await new Promise((resolve, reject) => {
        reader.onloadend = async () => {
          try {
            const base64Audio = (reader.result as string).split(',')[1];
            
            const response = await fetch("/api/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audio: base64Audio }),
            });

            if (!response.ok) throw new Error("Transcription failed");
            
            toast({
              title: "Transcribed",
              description: "Audio segment transcribed successfully",
            });
            
            onTranscribed();
            resolve(null);
          } catch (error) {
            reject(error);
          }
        };
        reader.onerror = reject;
      });
    } catch (error) {
      console.error("Transcription error:", error);
      toast({
        title: "Transcription failed",
        description: "Could not transcribe audio. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleClose = () => {
    stopRecording();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-recorder">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="w-5 h-5" />
            Audio Transcription
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex flex-col items-center justify-center py-8">
            <div className={`w-24 h-24 rounded-full flex items-center justify-center ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-muted'}`}>
              {isRecording ? (
                <Mic className="w-12 h-12 text-white" />
              ) : (
                <MicOff className="w-12 h-12 text-muted-foreground" />
              )}
            </div>
            
            <div className="mt-4 text-3xl font-bold tabular-nums" data-testid="text-timer">
              {formatTime(recordingTime)}
            </div>
            
            <div className="mt-2 text-sm text-muted-foreground">
              {isRecording ? "Recording continuously..." : "Stopped"}
            </div>
            
            {isTranscribing && (
              <div className="mt-4 flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Transcribing segment...</span>
              </div>
            )}
          </div>

          <div className="text-xs text-muted-foreground text-center">
            Audio is automatically transcribed every 30 seconds. Close when done.
          </div>

          <Button
            onClick={handleClose}
            className="w-full"
            variant="outline"
            data-testid="button-stop-recording"
          >
            Stop & Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
