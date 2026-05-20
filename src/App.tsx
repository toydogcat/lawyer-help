import { useState, useEffect, useRef } from 'react';
import { useWebLLM } from './hooks/useWebLLM';
import { tool_getTime, tool_searchLaw, tool_runMath } from './hooks/useLegalTools';
import { useEmbedding, VectorChunk } from './hooks/useEmbedding';
import { FileIngestion } from './components/FileIngestion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Scale, Send, ShieldCheck, Info, Loader2, Clock, Search, Calculator, Database } from 'lucide-react';

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

function App() {
    const { engine, progress, status, isLoaded, init } = useWebLLM();
    const { indexDocument, getEmbedding, cosineSimilarity, isIndexing } = useEmbedding();
    const [vectorDB, setVectorDB] = useState<VectorChunk[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleTextExtracted = async (text: string, fileName: string) => {
        const newChunks = await indexDocument(text, fileName);
        setVectorDB(prev => [...prev, ...newChunks]);
    };

    const handleSendMessage = async () => {
        if (!input.trim() || !engine || isThinking) return;

        const userQuery = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userQuery }]);
        setIsThinking(true);

        const currentMessages: any[] = [
            { role: "system", content: "你是一位專業的台灣法律助手。回答請務必遵守台灣法律規範並使用繁體中文。\n\n" +
                "你有權限使用以下工具（若需要請輸出對應的指令並停止）：\n" +
                "- [CALL: get_current_time()] 獲取現在時間\n" +
                "- [CALL: run_math_calculation(expression=\"...\")] 進行數學計算\n" +
                "- [CALL: search_taiwan_law(query=\"...\")] 查詢台灣法律資訊\n" +
                "- [CALL: search_local_docs(query=\"...\")] 搜尋使用者上傳的本地文件\n\n" +
                "請先判斷是否需要工具，若不需要則直接回答。" 
            },
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: "user", content: userQuery }
        ];

        try {
            let loopCount = 0;
            while (loopCount < 3) {
                const chunks = await engine.chat.completions.create({
                    messages: currentMessages,
                    stream: true,
                });

                let responseText = "";
                setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

                for await (const chunk of chunks) {
                    const delta = chunk.choices[0].delta.content || "";
                    responseText += delta;
                    setMessages(prev => {
                        const last = prev[prev.length - 1];
                        return [...prev.slice(0, -1), { ...last, content: responseText }];
                    });
                }

                const timeMatch = responseText.match(/\[CALL:\s*get_current_time\s*\(\)\]/);
                const mathMatch = responseText.match(/\[CALL:\s*run_math_calculation\(expression="([^"]+)"\)\]/);
                const lawMatch = responseText.match(/\[CALL:\s*search_taiwan_law\(query="([^"]+)"\)\]/);
                const localMatch = responseText.match(/\[CALL:\s*search_local_docs\(query="([^"]+)"\)\]/);

                let toolResult = "";
                let matchedCall = "";

                if (timeMatch) { toolResult = tool_getTime(); matchedCall = timeMatch[0]; }
                else if (mathMatch) { toolResult = tool_runMath(mathMatch[1]); matchedCall = mathMatch[0]; }
                else if (lawMatch) { toolResult = await tool_searchLaw(lawMatch[1]); matchedCall = lawMatch[0]; }
                else if (localMatch && vectorDB.length > 0) {
                    const queryEmb = await getEmbedding(localMatch[1]);
                    const scored = vectorDB.map(chunk => ({
                        ...chunk,
                        score: cosineSimilarity(queryEmb, chunk.embedding)
                    })).sort((a, b) => b.score - a.score).slice(0, 3);
                    toolResult = scored.length > 0 
                        ? scored.map(s => `來自 [${s.source}]: ${s.text}`).join('\n\n')
                        : "在本地文件中找不到相關資訊。";
                    matchedCall = localMatch[0];
                }

                if (toolResult) {
                    const toolMsg = `\n\n🛠️ **工具執行**: \`${matchedCall}\`\n\n${toolResult}\n\n---`;
                    setMessages(prev => {
                        const last = prev[prev.length - 1];
                        return [...prev.slice(0, -1), { ...last, content: last.content + toolMsg }];
                    });

                    currentMessages.push({ role: "assistant", content: responseText });
                    currentMessages.push({ role: "user", content: `[系統工具回傳]: ${toolResult}\n請分析以上結果並給出最終回答。` });
                    loopCount++;
                    continue;
                }
                break;
            }
        } catch (err) {
            console.error("Chat Error:", err);
            setMessages(prev => [...prev, { role: 'assistant', content: "抱歉，發生了錯誤。請再試一次。" }]);
        } finally {
            setIsThinking(false);
        }
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-200 p-4 md:p-8 font-sans selection:bg-cyan-500/30">
            <header className="max-w-5xl mx-auto mb-10 flex flex-col md:flex-row justify-between items-center gap-6 border-b border-neutral-800 pb-8">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-cyan-600/20 rounded-2xl border border-cyan-500/30">
                        <Scale className="w-8 h-8 text-cyan-500" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-2">
                            台灣法律助手 <span className="text-xs font-medium bg-neutral-800 px-2 py-1 rounded text-neutral-400 uppercase tracking-widest">v1.1 (RAG Enabled)</span>
                        </h1>
                        <p className="text-neutral-500 text-sm mt-1 flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4" /> 隱私加密：所有對話與模型運算均在您的瀏覽器本地完成
                        </p>
                    </div>
                </div>
                
                <div className="flex items-center gap-4">
                    {!isLoaded ? (
                        <button 
                            onClick={init}
                            disabled={status.includes("正在")}
                            className="group relative px-8 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl font-bold transition-all overflow-hidden"
                        >
                            <span className="relative z-10 flex items-center gap-2">
                                {status.includes("正在") ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                {status.includes("正在") ? "載入中..." : "啟動 AI 法律專家"}
                            </span>
                        </button>
                    ) : (
                        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 rounded-lg text-sm font-bold">
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                            系統在線
                        </div>
                    )}
                </div>
            </header>

            <main className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-8">
                <aside className="lg:col-span-1 space-y-6">
                    <section className="bg-neutral-900/50 backdrop-blur-sm p-6 rounded-2xl border border-neutral-800">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500 mb-4 flex items-center gap-2">
                            <Info className="w-4 h-4" /> 系統資訊
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <p className="text-xs text-neutral-500 mb-1">運行模型</p>
                                <p className="text-sm font-medium text-white">Gemma 2B (Quantized)</p>
                            </div>
                            <div>
                                <p className="text-xs text-neutral-500 mb-1">狀態</p>
                                <p className="text-sm font-medium text-cyan-400 truncate">{status}</p>
                                {progress > 0 && progress < 100 && (
                                    <div className="w-full bg-neutral-800 h-1.5 rounded-full mt-2 overflow-hidden">
                                        <div className="bg-cyan-500 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>

                    <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500 mb-4 flex items-center gap-2">
                            文件工具
                        </h2>
                        <FileIngestion onTextExtracted={handleTextExtracted} isProcessing={isIndexing} />
                        {vectorDB.length > 0 && (
                            <div className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-500 bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20">
                                <Database className="w-3 h-3" /> 已索引 {vectorDB.length} 個知識片段
                            </div>
                        )}
                    </section>

                    <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500 mb-4">
                            具備能力
                        </h2>
                        <ul className="space-y-3">
                            <li className="flex items-center gap-3 text-sm text-neutral-400">
                                <Search className="w-4 h-4 text-cyan-500" /> 法律資料庫查詢
                            </li>
                            <li className="flex items-center gap-3 text-sm text-neutral-400">
                                <Clock className="w-4 h-4 text-cyan-500" /> 即時本地時間
                            </li>
                            <li className="flex items-center gap-3 text-sm text-neutral-400">
                                <Calculator className="w-4 h-4 text-cyan-500" /> 法律數額計算
                            </li>
                        </ul>
                    </section>
                </aside>

                <div className="lg:col-span-3 flex flex-col h-[650px] bg-neutral-900 rounded-3xl border border-neutral-800 shadow-2xl overflow-hidden relative">
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent">
                        {messages.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
                                <div className="p-6 bg-neutral-800 rounded-full">
                                    <Scale className="w-12 h-12 text-neutral-600" />
                                </div>
                                <div>
                                    <p className="text-xl font-medium text-neutral-400">請開始您的法律諮詢</p>
                                    <p className="text-sm text-neutral-500">上傳 PDF 後，我將優先檢索文件內容</p>
                                </div>
                            </div>
                        )}
                        {messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
                                <div className={`max-w-[90%] md:max-w-[80%] p-4 rounded-2xl prose prose-invert prose-sm ${
                                    m.role === 'user' 
                                    ? 'bg-cyan-600 text-white rounded-tr-none' 
                                    : 'bg-neutral-800 text-neutral-200 rounded-tl-none'
                                } shadow-lg`}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {m.content}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        ))}
                        {isThinking && (
                            <div className="flex justify-start">
                                <div className="bg-neutral-800 p-4 rounded-2xl rounded-tl-none shadow-lg flex gap-1.5 items-center">
                                    <div className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                    <div className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                    <div className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce" />
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="p-6 bg-neutral-950/50 backdrop-blur-md border-t border-neutral-800">
                        <div className="flex gap-3 bg-neutral-800 p-2 rounded-2xl focus-within:ring-2 ring-cyan-500/50 transition-all border border-neutral-700 shadow-inner">
                            <input 
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                                placeholder={isLoaded ? "請描述您的法律問題..." : "請先啟動 AI..."}
                                disabled={!isLoaded || isThinking}
                                className="flex-1 bg-transparent border-none px-4 py-2 focus:outline-none text-white placeholder:text-neutral-500"
                            />
                            <button 
                                onClick={handleSendMessage}
                                disabled={isThinking || !isLoaded || !input.trim()}
                                className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 p-3 rounded-xl transition-colors shadow-lg shadow-cyan-950/20"
                            >
                                <Send className="w-5 h-5 text-white" />
                            </button>
                        </div>
                    </div>
                </div>
            </main>

            <footer className="max-w-5xl mx-auto mt-12 text-center text-neutral-600 text-xs">
                <p>© 2026 台灣法律助手 | 所有運算均在瀏覽器內存中進行，重新整理網頁將會清除對話歷史與索引文件。</p>
            </footer>
        </div>
    );
}

export default App;
