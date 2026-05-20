import { useCallback, useState } from 'react';

export function useSpeechSynthesis() {
    const [isSpeaking, setIsSpeaking] = useState(false);

    const speak = useCallback((text: string, rate: number = 1.1) => {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-TW';
        utterance.rate = rate;
        utterance.pitch = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const chiVoice = voices.find(v => v.lang.includes('zh-TW') || v.lang.includes('zh-CN'));
        if (chiVoice) utterance.voice = chiVoice;

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        window.speechSynthesis.speak(utterance);
    }, []);

    const stop = useCallback(() => {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
    }, []);

    return { speak, stop, isSpeaking };
}
