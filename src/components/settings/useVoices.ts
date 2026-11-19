import { useEffect, useState } from "react";

/** The system speech voices. They load asynchronously, so listen for the browser telling us they are ready. */
export function useVoices(): SpeechSynthesisVoice[] {
  const read = (): SpeechSynthesisVoice[] =>
    typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis.getVoices() : [];
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(read);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return undefined;
    const refresh = (): void => setVoices(read());
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, []);

  return voices;
}
