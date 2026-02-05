import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Pause, Play, Square, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RecordingBarProps {
  notebookId?: string | null;
  onTranscribed: () => void;
  isRecordingRequested?: boolean;
  onRecordingStarted?: () => void;
}

export function RecordingBar({ notebookId, onTranscribed, isRecordingRequested, onRecordingStarted }: RecordingBarProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const segmentTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pauseTimeRef = useRef<number>(0);
  const segmentStartTimeRef = useRef<number>(0);
  const isRecordingRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const { toast } = useToast();

  const SEGMENT_DURATION = 30000;

  useEffect(() => {
    return () => {
      stopRecording();
      if (timerRef.current) clearInterval(timerRef.current);
      if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
    };
  }, []);

  // Start recording when requested externally
  useEffect(() => {
    if (isRecordingRequested && !isRecording) {
      startRecording();
      onRecordingStarted?.();
    }
  }, [isRecordingRequested]);

  const startRecording = async () => {
    try {
      // Clear any existing timers
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (segmentTimerRef.current) {
        clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      segmentStartTimeRef.current = Date.now();

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        await transcribeAudio(audioBlob);
        chunksRef.current = [];
        
        // Continue recording if not manually stopped (check ref not state)
        if (isRecordingRef.current && !isPausedRef.current) {
          startRecording();
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setIsPaused(false);
      isRecordingRef.current = true;
      isPausedRef.current = false;
      pauseTimeRef.current = 0;

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

      if (recordingTime === 0) {
        toast({
          title: "Recording started",
          description: "Audio will be transcribed every 30 seconds",
        });
      }

    } catch (error) {
      toast({
        title: "Microphone Error",
        description: "Unable to access microphone. Please check permissions.",
        variant: "destructive",
      });
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      isPausedRef.current = true;
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (segmentTimerRef.current) {
        clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }
      pauseTimeRef.current = Date.now();
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      isPausedRef.current = false;
      
      // Resume timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      // Calculate remaining time for segment based on when segment started
      const now = Date.now();
      const segmentElapsed = now - segmentStartTimeRef.current - (pauseTimeRef.current > 0 ? now - pauseTimeRef.current : 0);
      const remaining = Math.max(SEGMENT_DURATION - segmentElapsed, 1000);

      segmentTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, remaining);
      
      pauseTimeRef.current = 0;
    }
  };

  const stopRecording = () => {
    // Update refs first so onstop handler knows to stop
    isRecordingRef.current = false;
    isPausedRef.current = false;
    
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state === "recording" || mediaRecorderRef.current.state === "paused") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    
    setIsRecording(false);
    setIsPaused(false);
    setRecordingTime(0);
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }

    toast({
      title: "Recording stopped",
      description: "All audio has been transcribed",
    });
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsTranscribing(true);
    
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      
      await new Promise((resolve, reject) => {
        reader.onloadend = async () => {
          try {
            const base64Audio = (reader.result as string).split(',')[1];
            
            const response = await fetch("/api/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audio: base64Audio, notebookId }),
            });

            if (!response.ok) throw new Error("Transcription failed");
            
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
        description: "Could not transcribe audio segment",
        variant: "destructive",
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isRecording) {
    return null; // Don't render when not recording - let parent handle the start button
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t bg-red-500/10 backdrop-blur supports-[backdrop-filter]:bg-red-500/5 z-50">
      <div className="container max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
            <span className="text-lg font-bold tabular-nums" data-testid="text-recording-timer">
              {formatTime(recordingTime)}
            </span>
            {isTranscribing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Transcribing...</span>
              </div>
            )}
            {!isTranscribing && (
              <span className="text-sm text-muted-foreground">
                {isPaused ? "Paused" : "Recording..."}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isPaused ? (
              <Button
                onClick={resumeRecording}
                variant="default"
                size="sm"
                data-testid="button-resume-recording"
              >
                <Play className="w-4 h-4 mr-2" />
                Resume
              </Button>
            ) : (
              <Button
                onClick={pauseRecording}
                variant="outline"
                size="sm"
                data-testid="button-pause-recording"
              >
                <Pause className="w-4 h-4 mr-2" />
                Pause
              </Button>
            )}
            
            <Button
              onClick={stopRecording}
              variant="destructive"
              size="sm"
              data-testid="button-stop-recording"
            >
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
