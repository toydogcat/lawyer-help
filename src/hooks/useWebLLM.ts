import { useState, useCallback } from 'react';
import * as webllm from '@mlc-ai/web-llm';

export function useWebLLM() {
    const [engine, setEngine] = useState<webllm.MLCEngineInterface | null>(null);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState("未初始化");
    const [isLoaded, setIsLoaded] = useState(false);

    const init = useCallback(async () => {
        if (engine) return;
        
        setStatus("正在初始化...");
        const initProgressCallback = (report: webllm.InitProgressReport) => {
            setProgress(Math.round(report.progress * 100));
            setStatus(report.text);
        };

        try {
            // Using Gemma model as requested
            const selectedModel = "gemma-2b-it-q4f32_1-MLC";
            const newEngine = await webllm.CreateMLCEngine(
                selectedModel,
                { initProgressCallback }
            );
            setEngine(newEngine);
            setIsLoaded(true);
            setStatus("準備就緒");
        } catch (err) {
            console.error("WebLLM Init Error:", err);
            setStatus("初始化失敗: " + (err instanceof Error ? err.message : String(err)));
        }
    }, [engine]);

    return { engine, progress, status, isLoaded, init };
}
