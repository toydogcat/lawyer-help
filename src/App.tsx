import { useState, useEffect, useRef } from 'react';
import { useWebLLM } from './hooks/useWebLLM';
import { tool_getTime, tool_searchLaw, tool_runMath } from './hooks/useLegalTools';
import { useEmbedding, type VectorChunk } from './hooks/useEmbedding';
import { FileIngestion } from './components/FileIngestion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Scale, Send, ShieldCheck, Settings, MessageSquare, Info, Loader2, Clock, Search, Calculator, Database, X } from 'lucide-react';

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
    const [showSettings, setShowSettings] = useState(false);
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

        const systemPrompt = `你是一位專業的台灣法律助手。請遵循以下規則：
1. 使用繁體中文回答。
2. 若需要外部資訊，請**務必**使用以下格式調用工具並停止輸出：
   - [CALL: get_current_time()] (獲取現在時間)
   - [CALL: search_taiwan_law(query="關鍵字")] (查詢台灣法律、判決、法規)
   - [CALL: search_local_docs(query="關鍵字")] (搜尋使用者剛才上傳的 PDF 文件)
3. 優先順序：若使用者問的是上傳文件的內容，請先用 search_local_docs。若問的是一般法律，請用 search_taiwan_law。
4. 如果不需要工具，請直接提供專業的法律建議。

使用者問題：${userQuery}`;

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

                // 精準匹配工具調用
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
                    const toolMsg = `\n\n🛠️ **工具回傳**: \`${matchedCall}\`\n\n${toolResult}\n\n---`;
                    setMessages(prev => {
                        const last = prev[prev.length - 1];
                        return [...prev.slice(0, -1), { ...last, content: last.content + toolMsg }];
                    });

                    currentMessages.push({ role: "assistant", content: responseText });
                    currentMessages.push({ role: "user", content: `[系統工具結果]: ${toolResult}\n請根據以上資訊給出最終繁體中文回答。` });
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
        <div className="flex h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-cyan-500/30 overflow-hidden">
            {/* Left Rail / Navigation */}
            <nav className="w-16 flex flex-col items-center py-6 border-r border-neutral-900 bg-black/50 gap-6">
                <div className="p-2 bg-cyan-600/20 rounded-xl border border-cyan-500/30 mb-4">
                    <Scale className="w-6 h-6 text-cyan-500" />
                </div>
                <button 
                    onClick={() => setShowSettings(false)}
                    className={`p-3 rounded-xl transition-all ${!showSettings ? 'bg-neutral-800 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-200'}`}
                >
                    <MessageSquare className="w-6 h-6" />
                </button>
                <button 
                    onClick={() => setShowSettings(true)}
                    className={`p-3 rounded-xl transition-all ${showSettings ? 'bg-neutral-800 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-200'}`}
                >
                    <Settings className="w-6 h-6" />
                </button>
            </nav>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col relative">
                {/* Header */}
                <header className="px-8 py-4 border-b border-neutral-900 bg-black/20 flex justify-between items-center backdrop-blur-md">
                    <div>
                        <h1 className="text-lg font-bold text-white flex items-center gap-2">
                            台灣法律助手 <span className="text-[10px] bg-cyan-500/10 text-cyan-500 px-1.5 py-0.5 rounded border border-cyan-500/20">PRO</span>
                        </h1>
                        <p className="text-xs text-neutral-500">Local AI & RAG Engine</p>
                    </div>
                    <div className="flex items-center gap-3">
                        {!isLoaded && (
                            <button 
                                onClick={init}
                                disabled={status.includes("正在")}
                                className="text-xs px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold flex items-center gap-2 transition-all"
                            >
                                {status.includes("正在") && <Loader2 className="w-3 h-3 animate-spin" />}
                                啟動 AI
                            </button>
                        )}
                        <div className={`w-2 h-2 rounded-full ${isLoaded ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-700'}`} title={status} />
                    </div>
                </header>

                {showSettings ? (
                    /* Settings / Setup Page */
                    <div className="flex-1 overflow-y-auto p-8 max-w-3xl mx-auto w-full animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="flex justify-between items-center mb-8">
                            <h2 className="text-2xl font-bold text-white">系統設定</h2>
                            <button onClick={() => setShowSettings(false)} className="text-neutral-500 hover:text-white"><X className="w-6 h-6" /></button>
                        </div>

                        <div className="space-y-8">
                            <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 mb-4 flex items-center gap-2">
                                    <Database className="w-4 h-4" /> 文件庫 (RAG)
                                </h3>
                                <FileIngestion onTextExtracted={handleTextExtracted} isProcessing={isIndexing} />
                                {vectorDB.length > 0 && (
                                    <div className="mt-4 p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-500">
                                                <Database className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-emerald-400">已索引完成</p>
                                                <p className="text-xs text-emerald-600">{vectorDB.length} 個知識片段已準備就緒</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </section>

                            <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 mb-4 flex items-center gap-2">
                                    <Info className="w-4 h-4" /> 模型與狀態
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-black/30 rounded-xl border border-neutral-800">
                                        <p className="text-[10px] text-neutral-500 uppercase font-bold mb-1">Model</p>
                                        <p className="text-sm text-white">Gemma 2B IT</p>
                                    </div>
                                    <div className="p-4 bg-black/30 rounded-xl border border-neutral-800">
                                        <p className="text-[10px] text-neutral-500 uppercase font-bold mb-1">Status</p>
                                        <p className="text-sm text-cyan-400 truncate">{status}</p>
                                    </div>
                                </div>
                                {progress > 0 && progress < 100 && (
                                    <div className="mt-4">
                                        <div className="flex justify-between text-[10px] font-bold text-neutral-500 mb-1">
                                            <span>LOADING PROGRESS</span>
                                            <span>{progress}%</span>
                                        </div>
                                        <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-cyan-500 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
                                        </div>
                                    </div>
                                )}
                            </section>

                            <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 mb-4">具備能力</h3>
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3 text-sm text-neutral-300">
                                        <Search className="w-4 h-4 text-cyan-500" /> 查詢台灣法律資料庫 (維基百科接口)
                                    </div>
                                    <div className="flex items-center gap-3 text-sm text-neutral-300">
                                        <Clock className="w-4 h-4 text-cyan-500" /> 讀取目前本地時間
                                    </div>
                                    <div className="flex items-center gap-3 text-sm text-neutral-300">
                                        <Calculator className="w-4 h-4 text-cyan-500" /> 法律金額與日期計算
                                    </div>
                                </div>
                            </section>
                        </div>
                    </div>
                ) : (
                    /* Chat Window - Default View */
                    <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-500">
                        <div className="flex-1 overflow-y-auto p-6 md:p-12 space-y-8 scroll-smooth">
                            {messages.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto text-center space-y-6">
                                    <div className="w-20 h-20 bg-neutral-900 rounded-3xl flex items-center justify-center border border-neutral-800 shadow-xl">
                                        <Scale className="w-10 h-10 text-cyan-500" />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-white mb-2">您好，我是您的法律助手</h2>
                                        <p className="text-neutral-500 text-sm leading-relaxed">
                                            您可以詢問法律問題、請我分析法規，或是上傳 PDF 文件進行專屬檢索。
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 w-full">
                                        <button 
                                            onClick={() => setInput("如果我不投票會犯法嗎？")}
                                            className="px-4 py-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl text-xs text-left text-neutral-400 transition-colors"
                                        >
                                            「如果我不投票會犯法嗎？」
                                        </button>
                                        <button 
                                            onClick={() => setInput("請查一下勞基法關於特休的規定。")}
                                            className="px-4 py-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl text-xs text-left text-neutral-400 transition-colors"
                                        >
                                            「請查一下勞基法關於特休的規定。」
                                        </button>
                                    </div>
                                    {!isLoaded && (
                                        <p className="text-[10px] text-neutral-600 uppercase tracking-tighter">請先點擊右上角「啟動 AI」以開始對話</p>
                                    )}
                                </div>
                            )}
                            {messages.map((m, i) => (
                                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                                    <div className={`max-w-[85%] md:max-w-[75%] p-5 rounded-2xl prose prose-invert prose-sm shadow-2xl ${
                                        m.role === 'user' 
                                        ? 'bg-cyan-600 text-white rounded-tr-none' 
                                        : 'bg-neutral-900 text-neutral-200 border border-neutral-800 rounded-tl-none'
                                    }`}>
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {m.content}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            ))}
                            {isThinking && (
                                <div className="flex justify-start">
                                    <div className="bg-neutral-900 p-5 rounded-2xl rounded-tl-none border border-neutral-800 shadow-xl flex gap-1.5 items-center">
                                        <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                        <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                        <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce" />
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <div className="p-6 md:p-10 bg-gradient-to-t from-neutral-950 via-neutral-950 to-transparent">
                            <div className="max-w-4xl mx-auto relative group">
                                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-600 to-purple-600 rounded-2xl blur opacity-10 group-focus-within:opacity-30 transition-opacity" />
                                <div className="relative flex gap-3 bg-neutral-900 p-2.5 rounded-2xl border border-neutral-800 shadow-2xl items-end">
                                    <textarea 
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSendMessage();
                                            }
                                        }}
                                        placeholder={isLoaded ? "輸入法律問題 (Shift+Enter 換行)..." : "請點擊右上角啟動 AI..."}
                                        disabled={!isLoaded || isThinking}
                                        rows={1}
                                        className="flex-1 bg-transparent border-none px-4 py-3 focus:outline-none text-white placeholder:text-neutral-600 resize-none min-h-[50px] max-h-[200px]"
                                        style={{ height: 'auto' }}
                                        onInput={(e) => {
                                            const target = e.target as HTMLTextAreaElement;
                                            target.style.height = 'auto';
                                            target.style.height = target.scrollHeight + 'px';
                                        }}
                                    />
                                    <button 
                                        onClick={handleSendMessage}
                                        disabled={isThinking || !isLoaded || !input.trim()}
                                        className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-20 p-4 rounded-xl transition-all shadow-lg hover:scale-105 active:scale-95"
                                    >
                                        <Send className="w-5 h-5 text-white" />
                                    </button>
                                </div>
                                <p className="mt-3 text-center text-[10px] text-neutral-600">
                                    <ShieldCheck className="inline w-3 h-3 mr-1" /> 
                                    所有對話資料皆受本地加密保護，重新整理頁面即清除。
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
