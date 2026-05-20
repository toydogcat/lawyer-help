import { useState, useCallback, useRef } from 'react';

export function useSpeechRecognition(onResult: (text: string) => void) {
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<any>(null);

    const startListening = useCallback(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("您的瀏覽器不支援語音辨識功能。");
            return;
        }

        if (!recognitionRef.current) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.lang = 'zh-TW';
            recognitionRef.current.interimResults = false;
            recognitionRef.current.maxAlternatives = 1;

            recognitionRef.current.onresult = (event: any) => {
                const text = event.results[0][0].transcript;
                onResult(text);
                setIsListening(false);
            };

            recognitionRef.current.onerror = (event: any) => {
                console.error("Speech Recognition Error:", event.error);
                setIsListening(false);
            };

            recognitionRef.current.onend = () => {
                setIsListening(false);
            };
        }

        try {
            recognitionRef.current.start();
            setIsListening(true);
        } catch (err) {
            console.error("Failed to start recognition:", err);
        }
    }, [onResult]);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            setIsListening(false);
        }
    }, []);

    return { isListening, startListening, stopListening };
}
