import { useState, useEffect, useRef } from 'react';
import { useWebLLM } from './hooks/useWebLLM';
import { tool_getTime, tool_searchLaw } from './hooks/useLegalTools';
import { useEmbedding, type VectorChunk } from './hooks/useEmbedding';
import { FileIngestion } from './components/FileIngestion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
    Scale, Send, ShieldCheck, Settings, MessageSquare, Loader2, 
    Database, X, RotateCcw, User, Trash2, Maximize2, Activity, Sliders
} from 'lucide-react';

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

function App() {
    const { engine, status, isLoaded, init } = useWebLLM();
    const { indexDocument, getEmbedding, cosineSimilarity, isIndexing } = useEmbedding();
    
    // State
    const [vectorDB, setVectorDB] = useState<VectorChunk[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    
    // User Prefs
    const [userName, setUserName] = useState('使用者');
    const [userRole, setUserRole] = useState('一般民眾');
    const [chatWidth, setChatWidth] = useState(800);
    
    // LLM Parameters
    const [temperature, setTemperature] = useState(0.7);
    const [topP, setTopP] = useState(0.95);
    const [topK, setTopK] = useState(40);
    
    // Memory Analytics
    const [sessionSize, setSessionSize] = useState({ messages: 0, vectors: 0 });

    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const msgSize = messages.reduce((acc, m) => acc + (m.content.length * 2), 0);
        const vecSize = vectorDB.reduce((acc, v) => acc + (v.text.length * 2) + (v.embedding.length * 4), 0);
        setSessionSize({ messages: msgSize, vectors: vecSize });
    }, [messages, vectorDB]);

    const handleResetSession = () => {
        if (window.confirm("確定要清除所有對話紀錄嗎？")) {
            setMessages([]);
            setIsThinking(false);
        }
    };

    const clearOnlyPDF = () => {
        if (window.confirm("確定要移除所有已索引的文件片段嗎？")) setVectorDB([]);
    };

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

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const handleSendMessage = async () => {
        if (!input.trim() || !engine || isThinking) return;

        const userQuery = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userQuery }]);
        setIsThinking(true);

        const systemPrompt = `你是一位專業的台灣法律助手。
對象：${userName} (${userRole})
規則：使用繁體中文，視需要調用工具：
- [CALL: get_current_time()]
- [CALL: search_taiwan_law(query="...")]
- [CALL: search_local_docs(query="...")]
不需要工具則直接專業回答。`;

        const currentMessages: any[] = [
            { role: "system", content: systemPrompt },
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: "user", content: userQuery }
        ];

        try {
            let loopCount = 0;
            while (loopCount < 5) {
                const chunks = await engine.chat.completions.create({
                    messages: currentMessages,
                    stream: true,
                    temperature: temperature,
                    top_p: topP,
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
                const lawMatch = responseText.match(/\[CALL:\s*search_taiwan_law\(query="([^"]+)"\)\]/);
                const localMatch = responseText.match(/\[CALL:\s*search_local_docs\(query="([^"]+)"\)\]/);

                let toolResult = "";
                let matchedCall = "";

                if (timeMatch) { toolResult = tool_getTime(); matchedCall = timeMatch[0]; }
                else if (lawMatch) { toolResult = await tool_searchLaw(lawMatch[1]); matchedCall = lawMatch[0]; }
                else if (localMatch && vectorDB.length > 0) {
                    const queryEmb = await getEmbedding(localMatch[1]);
                    const scored = vectorDB.map(chunk => ({
                        ...chunk,
                        score: cosineSimilarity(queryEmb, chunk.embedding)
                    })).sort((a, b) => b.score - a.score).slice(0, 3);
                    toolResult = scored.length > 0 ? scored.map(s => `[${s.source}]: ${s.text}`).join('\n\n') : "無相關文件內容。";
                    matchedCall = localMatch[0];
                }

                if (toolResult) {
                    const toolMsg = `\n\n🛠️ **工具回傳**: \`${matchedCall}\`\n\n${toolResult}\n\n---`;
                    setMessages(prev => {
                        const last = prev[prev.length - 1];
                        return [...prev.slice(0, -1), { ...last, content: last.content + toolMsg }];
                    });
                    currentMessages.push({ role: "assistant", content: responseText });
                    currentMessages.push({ role: "user", content: `工具結果: ${toolResult}\n請給出最終回答。` });
                    loopCount++;
                    continue;
                }
                break;
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsThinking(false);
        }
    };

    return (
        <div className="flex h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-cyan-500/30 overflow-hidden">
            <nav className="w-16 flex flex-col items-center py-6 border-r border-neutral-900 bg-black/50 gap-6">
                <div className="p-2 bg-cyan-600/20 rounded-xl border border-cyan-500/30 mb-4">
                    <Scale className="w-6 h-6 text-cyan-500" />
                </div>
                <button onClick={() => setShowSettings(false)} className={`p-3 rounded-xl transition-all ${!showSettings ? 'bg-neutral-800 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-200'}`}>
                    <MessageSquare className="w-6 h-6" />
                </button>
                <button onClick={() => setShowSettings(true)} className={`p-3 rounded-xl transition-all ${showSettings ? 'bg-neutral-800 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-200'}`}>
                    <Settings className="w-6 h-6" />
                </button>
            </nav>

            <main className="flex-1 flex flex-col relative">
                <header className="px-8 py-4 border-b border-neutral-900 bg-black/20 flex justify-between items-center backdrop-blur-md">
                    <div>
                        <h1 className="text-lg font-bold text-white flex items-center gap-2">台灣法律助手 <span className="text-[10px] bg-cyan-500/10 text-cyan-500 px-1.5 py-0.5 rounded border border-cyan-500/20">PRO</span></h1>
                        <p className="text-xs text-neutral-500">Local AI & RAG Engine</p>
                    </div>
                    <div className="flex items-center gap-4">
                        {isLoaded && !showSettings && (
                            <button onClick={() => handleResetSession()} className="p-2 text-neutral-500 hover:text-white hover:bg-neutral-800 rounded-lg transition-all" title="重新開始對話">
                                <RotateCcw className="w-5 h-5" />
                            </button>
                        )}
                        {!isLoaded && (
                            <button onClick={init} disabled={status.includes("正在")} className="text-xs px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold flex items-center gap-2">
                                {status.includes("正在") && <Loader2 className="w-3 h-3 animate-spin" />}
                                啟動 AI
                            </button>
                        )}
                        <div className={`w-2 h-2 rounded-full ${isLoaded ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-700'}`} title={status} />
                    </div>
                </header>

                {showSettings ? (
                    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="flex justify-between items-center mb-8">
                            <h2 className="text-2xl font-bold text-white">進階設定</h2>
                            <button onClick={() => setShowSettings(false)} className="text-neutral-500 hover:text-white"><X className="w-6 h-6" /></button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* User Prefs */}
                            <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800 space-y-4">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 flex items-center gap-2"><User className="w-4 h-4 text-purple-500" /> 使用者認知</h3>
                                <div className="space-y-3">
                                    <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} className="w-full bg-black/40 border border-neutral-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500" placeholder="稱呼" />
                                    <select value={userRole} onChange={(e) => setUserRole(e.target.value)} className="w-full bg-black/40 border border-neutral-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500">
                                        <option value="一般民眾">一般民眾 (白話解釋)</option>
                                        <option value="法律從業人員">法律從業人員 (專業學理)</option>
                                        <option value="企業經營者">企業經營者 (風險導向)</option>
                                    </select>
                                </div>
                            </section>

                            {/* Inference Params */}
                            <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800 space-y-4">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 flex items-center gap-2"><Sliders className="w-4 h-4 text-emerald-500" /> 生成參數控制</h3>
                                <div className="space-y-4">
                                    <div>
                                        <div className="flex justify-between text-[10px] mb-1">
                                            <label className="text-neutral-500 font-bold">Temperature ({temperature})</label>
                                            <span className="text-emerald-500">創造力</span>
                                        </div>
                                        <input type="range" min="0" max="1.5" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full accent-emerald-500 bg-neutral-800 h-1 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[10px] mb-1">
                                            <label className="text-neutral-500 font-bold">Top-P ({topP})</label>
                                            <span className="text-emerald-500">核心採樣</span>
                                        </div>
                                        <input type="range" min="0.1" max="1" step="0.05" value={topP} onChange={(e) => setTopP(parseFloat(e.target.value))} className="w-full accent-emerald-500 bg-neutral-800 h-1 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[10px] mb-1">
                                            <label className="text-neutral-500 font-bold">Top-K ({topK})</label>
                                            <span className="text-emerald-500">候選詞數</span>
                                        </div>
                                        <input type="range" min="1" max="100" step="1" value={topK} onChange={(e) => setTopK(parseInt(e.target.value))} className="w-full accent-emerald-500 bg-neutral-800 h-1 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                </div>
                            </section>

                            {/* UI Layout */}
                            <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800 space-y-4">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 flex items-center gap-2"><Maximize2 className="w-4 h-4 text-amber-500" /> 介面佈局</h3>
                                <div className="flex justify-between mb-1">
                                    <label className="text-[10px] text-neutral-500 font-bold uppercase">對話框寬度 ({chatWidth}px)</label>
                                </div>
                                <input type="range" min="400" max="1200" step="50" value={chatWidth} onChange={(e) => setChatWidth(parseInt(e.target.value))} className="w-full accent-amber-500 bg-neutral-800 h-1 rounded-lg appearance-none cursor-pointer" />
                            </section>

                            {/* Analytics */}
                            <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800 space-y-4">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 flex items-center gap-2"><Activity className="w-4 h-4 text-rose-500" /> 資源監控</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-3 bg-black/30 rounded-xl border border-neutral-800">
                                        <p className="text-[8px] text-neutral-500 font-bold mb-1">對話快取</p>
                                        <p className="text-xs text-white font-mono">{formatSize(sessionSize.messages)}</p>
                                    </div>
                                    <div className="p-3 bg-black/30 rounded-xl border border-neutral-800">
                                        <p className="text-[8px] text-neutral-500 font-bold mb-1">文件向量</p>
                                        <p className="text-xs text-white font-mono">{formatSize(sessionSize.vectors)}</p>
                                    </div>
                                </div>
                            </section>

                            {/* RAG & System */}
                            <section className="md:col-span-2 bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800 space-y-4">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 flex items-center gap-2"><Database className="w-4 h-4 text-emerald-500" /> 本地法律文件庫</h3>
                                    {vectorDB.length > 0 && <button onClick={clearOnlyPDF} className="text-[10px] font-bold text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 bg-red-400/10 rounded border border-red-400/20"><Trash2 className="w-3 h-3" /> 移除索引</button>}
                                </div>
                                <FileIngestion onTextExtracted={handleTextExtracted} isProcessing={isIndexing} />
                            </section>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-500">
                        <div className="flex-1 overflow-y-auto p-6 md:p-12 space-y-8 scroll-smooth">
                            <div className="mx-auto transition-all duration-300" style={{ maxWidth: `${chatWidth}px` }}>
                                {messages.length === 0 && (
                                    <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto text-center space-y-6 py-20">
                                        <div className="w-20 h-20 bg-neutral-900 rounded-3xl flex items-center justify-center border border-neutral-800 shadow-xl"><Scale className="w-10 h-10 text-cyan-500" /></div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-white mb-2">您好，{userName}</h2>
                                            <p className="text-neutral-500 text-sm leading-relaxed">我是您的法律助手。目前以「{userRole}」視角為您提供建議。</p>
                                        </div>
                                    </div>
                                )}
                                {messages.map((m, i) => (
                                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300 mb-8`}>
                                        <div className={`max-w-[85%] md:max-w-[80%] p-5 rounded-2xl prose prose-invert prose-sm shadow-2xl ${m.role === 'user' ? 'bg-cyan-600 text-white rounded-tr-none' : 'bg-neutral-900 text-neutral-200 border border-neutral-800 rounded-tl-none'}`}>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                                        </div>
                                    </div>
                                ))}
                                {isThinking && (
                                    <div className="flex justify-start mb-8">
                                        <div className="bg-neutral-900 p-5 rounded-2xl rounded-tl-none border border-neutral-800 shadow-xl flex gap-1.5 items-center">
                                            <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                            <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                            <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce" />
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        <div className="p-6 md:p-10 bg-gradient-to-t from-neutral-950 via-neutral-950 to-transparent">
                            <div className="mx-auto relative group transition-all duration-300" style={{ maxWidth: `${chatWidth}px` }}>
                                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-600 to-purple-600 rounded-2xl blur opacity-10 group-focus-within:opacity-30 transition-opacity" />
                                <div className="relative flex gap-3 bg-neutral-900 p-2.5 rounded-2xl border border-neutral-800 shadow-2xl items-end">
                                    <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder={isLoaded ? "輸入法律問題..." : "請啟動 AI..."} disabled={!isLoaded || isThinking} rows={1} className="flex-1 bg-transparent border-none px-4 py-3 focus:outline-none text-white placeholder:text-neutral-600 resize-none min-h-[50px] max-h-[200px]" onInput={(e) => { const target = e.target as HTMLTextAreaElement; target.style.height = 'auto'; target.style.height = target.scrollHeight + 'px'; }} />
                                    <button onClick={handleSendMessage} disabled={isThinking || !isLoaded || !input.trim()} className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-20 p-4 rounded-xl transition-all shadow-lg hover:scale-105 active:scale-95"><Send className="w-5 h-5 text-white" /></button>
                                </div>
                                <div className="mt-3 flex justify-between items-center text-[8px] text-neutral-600 uppercase tracking-widest px-2">
                                    <span><ShieldCheck className="inline w-2.5 h-2.5 mr-1" /> End-to-End Local Privacy</span>
                                    <span>Session: {formatSize(sessionSize.messages + sessionSize.vectors)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
