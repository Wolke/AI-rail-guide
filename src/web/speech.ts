export interface SpeechStatus {
  synthesisSupported: boolean;
  recognitionSupported: boolean;
  speaking: boolean;
  listening: boolean;
}

export interface SpeechController {
  status: SpeechStatus;
  speak(text: string, onEnd: () => void): void;
  stop(): void;
  startListening(onResult: (text: string) => void, onEnd: () => void): void;
  stopListening(): void;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionConstructor = new () => RecognitionLike;

export function createSpeechController(onStatus: (status: SpeechStatus) => void): SpeechController {
  const scope = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  const status: SpeechStatus = {
    synthesisSupported: "speechSynthesis" in window,
    recognitionSupported: Boolean(Recognition),
    speaking: false,
    listening: false
  };
  let recognition: RecognitionLike | undefined;
  let fallbackTimer: number | undefined;
  const publish = () => onStatus({ ...status });

  return {
    status,
    speak(text, onEnd) {
      this.stop();
      status.speaking = true;
      publish();
      const finish = () => {
        if (!status.speaking) return;
        status.speaking = false;
        publish();
        onEnd();
      };
      if (status.synthesisSupported) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "zh-TW";
        utterance.rate = 1.02;
        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
      } else {
        fallbackTimer = window.setTimeout(finish, 3600);
      }
    },
    stop() {
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
      if (status.synthesisSupported) window.speechSynthesis.cancel();
      status.speaking = false;
      publish();
    },
    startListening(onResult, onEnd) {
      if (!Recognition || status.listening) return;
      const activeRecognition = new Recognition();
      recognition = activeRecognition;
      activeRecognition.lang = "zh-TW";
      activeRecognition.continuous = false;
      activeRecognition.interimResults = false;
      activeRecognition.onresult = (event) => onResult(event.results[0]?.[0]?.transcript ?? "");
      const finish = () => {
        status.listening = false;
        publish();
        onEnd();
      };
      activeRecognition.onend = finish;
      activeRecognition.onerror = finish;
      status.listening = true;
      publish();
      activeRecognition.start();
    },
    stopListening() {
      recognition?.stop();
    }
  };
}
