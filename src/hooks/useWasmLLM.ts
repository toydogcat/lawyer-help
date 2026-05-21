import { useState, useCallback } from 'react';
import { env, pipeline, TextStreamer } from '@huggingface/transformers';

export function useWasmLLM() {
    const [engine, setEngine] = useState<any>(null);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState("未初始化");
    const [isLoaded, setIsLoaded] = useState(false);

    const init = useCallback(async () => {
        if (engine) return;
        
        setStatus("正在初始化 Wasm 引擎...");
        
        try {
            // Disable WebGPU flags, strict Wasm initialization
            env.allowLocalModels = false;
            
            const generator = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
                device: 'wasm',
                progress_callback: (report: any) => {
                    if (report.status === 'progress') {
                        setProgress(Math.round(report.progress));
                        setStatus(`下載進度: ${Math.round(report.progress)}%`);
                    } else if (report.status === 'init') {
                        setStatus(`正在載入: ${report.file}`);
                    }
                }
            });
            
            // Normalize engine interface to match WebLLM's OpenAI API format
            const normalizedEngine = {
                chat: {
                    completions: {
                        create: async function* ({ messages, stream }: any) {
                            if (!stream) {
                                const response = await generator(messages, { max_new_tokens: 512 });
                                yield { choices: [{ delta: { content: (response[0] as any).generated_text.at(-1).content } }] };
                                return;
                            }

                            const queue: string[] = [];
                            let resolveWait: (() => void) | null = null;
                            let finished = false;

                            const streamer = new TextStreamer(generator.tokenizer, {
                                skip_prompt: true,
                                skip_special_tokens: true,
                                callback_function: (text: string) => {
                                    queue.push(text);
                                    if (resolveWait) {
                                        resolveWait();
                                        resolveWait = null;
                                    }
                                }
                            });

                            // Start generation asynchronously
                            generator(messages, { max_new_tokens: 1024, streamer })
                                .then(() => { 
                                    finished = true; 
                                    if (resolveWait) resolveWait(); 
                                })
                                .catch((e: any) => { 
                                    finished = true; 
                                    if (resolveWait) resolveWait(); 
                                    console.error("Wasm generation error:", e);
                                });

                            while (!finished || queue.length > 0) {
                                if (queue.length > 0) {
                                    const text = queue.shift();
                                    yield { choices: [{ delta: { content: text } }] };
                                } else {
                                    await new Promise<void>(resolve => { resolveWait = resolve; });
                                }
                            }
                        }
                    }
                }
            };

            setEngine(normalizedEngine);
            setIsLoaded(true);
            setStatus("準備就緒");
        } catch (err) {
            console.error("WasmLLM Init Error:", err);
            setStatus("初始化失敗: " + (err instanceof Error ? err.message : String(err)));
        }
    }, [engine]);

    return { engine, progress, status, isLoaded, init };
}
