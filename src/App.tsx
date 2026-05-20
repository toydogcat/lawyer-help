import { useState, useEffect, useRef } from 'react';
import { useWebLLM } from './hooks/useWebLLM';
import { tool_getTime, tool_searchLaw } from './hooks/useLegalTools';
import { useEmbedding, type VectorChunk } from './hooks/useEmbedding';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';
import { FileIngestion } from './components/FileIngestion';
import { LEGAL_TEMPLATES } from './constants/templates';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { 
    Scale, Send, ShieldCheck, Settings, MessageSquare, Loader2, 
    Database, X, RotateCcw, User, Trash2, Maximize2, Activity, Sliders,
    FilePlus, Download, Check, AlertTriangle, BookOpen, Mic, MicOff, Volume2, VolumeX, Speaker
} from 'lucide-react';

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    isDraft?: boolean;
}

function App() {
    const { engine, status, isLoaded, init } = useWebLLM();
    const { indexDocument, getEmbedding, cosineSimilarity, isIndexing } = useEmbedding();
    const { speak, stop: stopSpeaking, isSpeaking } = useSpeechSynthesis();
    
    // State
    const [vectorDB, setVectorDB] = useState<VectorChunk[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [activeTab, setActiveTab] = useState<'chat' | 'templates'>('chat');
    const [selectedCategory, setSelectedCategory] = useState<string>('全部');
    
    // User Prefs
    const [userName, setUserName] = useState('使用者');
    const [userRole, setUserRole] = useState('一般民眾');
    const [chatWidth, setChatWidth] = useState(800);
    const [autoSpeak, setAutoSpeak] = useState(false);
    const [voiceRate, setVoiceRate] = useState(1.1);
    
    // LLM Parameters
    const [temperature, setTemperature] = useState(0.7);
    const [topP, setTopP] = useState(0.95);
    
    // Memory Analytics
    const [sessionSize, setSessionSize] = useState({ messages: 0, vectors: 0 });

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    // Visitor Counter Injection (Fix for React SPA timing issue)
    useEffect(() => {
        const script = document.createElement('script');
        script.src = "https://www.vercount.one/js";
        script.async = true;
        document.head.appendChild(script);
        return () => {
            document.head.removeChild(script);
        };
    }, []);

    const categories = ['全部', ...new Set(Object.values(LEGAL_TEMPLATES).map(t => t.category))];

    const { isListening, startListening, stopListening } = useSpeechRecognition((text) => {
        setInput(prev => prev + text);
    });

    useEffect(() => {
        const msgSize = messages.reduce((acc, m) => acc + (m.content.length * 2), 0);
        const vecSize = vectorDB.reduce((acc, v) => acc + (v.text.length * 2) + (v.embedding.length * 4), 0);
        setSessionSize({ messages: msgSize, vectors: vecSize });
    }, [messages, vectorDB]);

    const handleResetSession = () => {
        if (window.confirm("確定要清除所有對話紀錄嗎？")) {
            setMessages([]);
            setIsThinking(false);
            stopSpeaking();
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

    const exportToPDF = async (index: number) => {
        const element = document.getElementById(`msg-content-${index}`);
        if (!element) return;

        try {
            const canvas = await html2canvas(element, {
                scale: 2,
                backgroundColor: "#ffffff",
                logging: false,
            });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const imgProps = pdf.getImageProperties(imgData);
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
            
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`legal_document_${index}.pdf`);
        } catch (err) {
            console.error("PDF Export Error:", err);
            alert("PDF 匯出失敗");
        }
    };

    const handleSelectTemplate = (templateKey: string) => {
        const template = LEGAL_TEMPLATES[templateKey];
        setInput(`請幫我代寫一份「${template.title}」。\n\n參考格式如下：\n${template.template}\n\n注意事項：${template.notice || "無"}\n\n請根據我之後提供的具體資訊來填充內容並產出專業法律文書。`);
        setActiveTab('chat');
    };

    const handleSendMessage = async () => {
        if (!input.trim() || !engine || isThinking) return;

        const userQuery = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userQuery }]);
        setIsThinking(true);
        stopSpeaking();

        const isDrafting = userQuery.includes("代寫") || userQuery.includes("契約") || userQuery.includes("訴狀") || userQuery.includes("協議書") || userQuery.includes("和解書");

        const systemPrompt = `你是一位專業的台灣法律助手。
對象：${userName} (${userRole})
規則：使用繁體中文，視需要調用工具：
- [CALL: get_current_time()]
- [CALL: search_taiwan_law(query="...")]
- [CALL: search_local_docs(query="...")]
${isDrafting ? "目前任務是「文書代寫」，請確保格式端正，條款專業且完全符合台灣民法、勞基法及相關法律慣例。" : ""}
不需要工具則直接專業回答。`;

        const currentMessages: any[] = [
            { role: "system", content: systemPrompt },
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: "user", content: userQuery }
        ];

        try {
            let loopCount = 0;
            let finalResponseText = "";
            while (loopCount < 5) {
                const chunks = await engine.chat.completions.create({
                    messages: currentMessages,
                    stream: true,
                    temperature: temperature,
                    top_p: topP,
                });

                let responseText = "";
                setMessages(prev => [...prev, { role: 'assistant', content: '', isDraft: isDrafting }]);

                for await (const chunk of chunks) {
                    const delta = chunk.choices[0].delta.content || "";
                    responseText += delta;
                    setMessages(prev => {
                        const last = prev[prev.length - 1];
                        return [...prev.slice(0, -1), { ...last, content: responseText }];
                    });
                }

                finalResponseText = responseText;
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

            if (autoSpeak && finalResponseText) {
                // Remove Markdown markers and tool calls for better TTS
                const cleanText = finalResponseText.replace(/\[CALL:.*?\]/g, "").replace(/[#*`]/g, "");
                speak(cleanText, voiceRate);
            }

        } catch (err) {
            console.error(err);
        } finally {
            setIsThinking(false);
        }
    };

    const filteredTemplates = Object.entries(LEGAL_TEMPLATES).filter(([_, t]) => 
        selectedCategory === '全部' || t.category === selectedCategory
    );

    return (
        <div className="flex h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-cyan-500/30 overflow-hidden">
            {/* Nav Rail */}
            <nav className="w-16 flex flex-col items-center py-6 border-r border-neutral-900 bg-black/50 gap-6">
                <div className="p-2 bg-cyan-600/20 rounded-xl border border-cyan-500/30 mb-4">
                    <Scale className="w-6 h-6 text-cyan-500" />
                </div>
                <button 
                    onClick={() => { setActiveTab('chat'); setShowSettings(false); }} 
                    className={`p-3 rounded-xl transition-all ${activeTab === 'chat' && !showSettings ? 'bg-neutral-800 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-200'}`}
                >
                    <MessageSquare className="w-6 h-6" />
                </button>
                <button 
                    onClick={() => { setActiveTab('templates'); setShowSettings(false); }} 
                    className={`p-3 rounded-xl transition-all ${activeTab === 'templates' && !showSettings ? 'bg-neutral-800 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-200'}`}
                >
                    <FilePlus className="w-6 h-6" />
                </button>
                <div className="flex-1" />
                <button 
                    onClick={() => setShowSettings(true)} 
                    className={`p-3 rounded-xl transition-all ${showSettings ? 'bg-neutral-800 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-200'}`}
                >
                    <Settings className="w-6 h-6" />
                </button>
            </nav>

            <main className="flex-1 flex flex-col relative">
                {/* Header */}
                <header className="px-8 py-4 border-b border-neutral-900 bg-black/20 flex justify-between items-center backdrop-blur-md">
                    <div>
                        <h1 className="text-lg font-bold text-white flex items-center gap-2">台灣法律助手 <span className="text-[10px] bg-cyan-500/10 text-cyan-500 px-1.5 py-0.5 rounded border border-cyan-500/20">PRO</span></h1>
                        <p className="text-xs text-neutral-500">Local AI & Voice Ready</p>
                    </div>
                    <div className="flex items-center gap-4">
                        {isSpeaking && (
                            <button onClick={stopSpeaking} className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg animate-pulse">
                                <VolumeX className="w-5 h-5" />
                            </button>
                        )}
                        {isLoaded && activeTab === 'chat' && !showSettings && (
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

                            {/* Voice Settings */}
                            <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800 space-y-4">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 flex items-center gap-2"><Speaker className="w-4 h-4 text-orange-500" /> 語音設定</h3>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-neutral-800">
                                        <div className="text-xs text-neutral-300">自動朗讀回答</div>
                                        <button 
                                            onClick={() => setAutoSpeak(!autoSpeak)}
                                            className={`w-10 h-5 rounded-full transition-colors relative ${autoSpeak ? 'bg-orange-600' : 'bg-neutral-800'}`}
                                        >
                                            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${autoSpeak ? 'right-1' : 'left-1'}`} />
                                        </button>
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[10px] mb-1">
                                            <label className="text-neutral-500 font-bold uppercase">語音速度 ({voiceRate}x)</label>
                                        </div>
                                        <input type="range" min="0.5" max="2" step="0.1" value={voiceRate} onChange={(e) => setVoiceRate(parseFloat(e.target.value))} className="w-full accent-orange-500 bg-neutral-800 h-1 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                </div>
                            </section>

                            <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800 space-y-4">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 flex items-center gap-2"><Sliders className="w-4 h-4 text-emerald-500" /> 生成參數控制</h3>
                                <div className="space-y-4">
                                    <div>
                                        <div className="flex justify-between text-[10px] mb-1">
                                            <label className="text-neutral-500 font-bold">Temperature ({temperature})</label>
                                        </div>
                                        <input type="range" min="0" max="1.5" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full accent-emerald-500 bg-neutral-800 h-1 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[10px] mb-1">
                                            <label className="text-neutral-500 font-bold">Top-P ({topP})</label>
                                        </div>
                                        <input type="range" min="0.1" max="1" step="0.05" value={topP} onChange={(e) => setTopP(parseFloat(e.target.value))} className="w-full accent-emerald-500 bg-neutral-800 h-1 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                </div>
                            </section>
                            <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800 space-y-4">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 flex items-center gap-2"><Maximize2 className="w-4 h-4 text-amber-500" /> 介面佈局</h3>
                                <input type="range" min="400" max="1200" step="50" value={chatWidth} onChange={(e) => setChatWidth(parseInt(e.target.value))} className="w-full accent-amber-500 bg-neutral-800 h-1 rounded-lg appearance-none cursor-pointer" />
                            </section>
                            <section className="bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800 space-y-4">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 flex items-center gap-2"><Activity className="w-4 h-4 text-rose-500" /> 資源監控</h3>
                                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                                    <div className="p-3 bg-black/30 rounded-xl border border-neutral-800">
                                        <p className="text-[8px] mb-1">對話: {formatSize(sessionSize.messages)}</p>
                                    </div>
                                    <div className="p-3 bg-black/30 rounded-xl border border-neutral-800">
                                        <p className="text-[8px] mb-1">文件: {formatSize(sessionSize.vectors)}</p>
                                    </div>
                                </div>
                            </section>
                            <section className="md:col-span-2 bg-neutral-900/50 p-6 rounded-2xl border border-neutral-800 space-y-4">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 flex items-center gap-2"><Database className="w-4 h-4 text-emerald-500" /> 本地文件庫 (RAG)</h3>
                                <FileIngestion onTextExtracted={handleTextExtracted} isProcessing={isIndexing} />
                                {vectorDB.length > 0 && <button onClick={clearOnlyPDF} className="mt-2 text-[10px] text-red-400 flex items-center gap-1"><Trash2 className="w-3 h-3" /> 移除索引</button>}
                            </section>
                        </div>
                    </div>
                ) : activeTab === 'templates' ? (
                    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="mb-10 text-center">
                            <h2 className="text-3xl font-black text-white mb-2">法律文書範本中心</h2>
                            <p className="text-neutral-500">依據台灣法律實務分類，選擇範本進行專業代寫</p>
                        </div>

                        <div className="flex flex-wrap justify-center gap-2 mb-8">
                            {categories.map(cat => (
                                <button 
                                    key={cat}
                                    onClick={() => setSelectedCategory(cat)}
                                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all border ${
                                        selectedCategory === cat 
                                        ? 'bg-cyan-600 border-cyan-500 text-white' 
                                        : 'bg-neutral-900 border-neutral-800 text-neutral-500 hover:border-neutral-700'
                                    }`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {filteredTemplates.map(([key, t]) => (
                                <div key={key} className="flex flex-col bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden group hover:border-cyan-500/50 transition-all">
                                    <div className="p-6 flex-1">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="p-2 bg-neutral-800 rounded-lg"><BookOpen className="w-5 h-5 text-cyan-500" /></div>
                                            <span className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest">{t.category}</span>
                                        </div>
                                        <h3 className="text-lg font-bold text-white mb-2">{t.title}</h3>
                                        <p className="text-xs text-neutral-500 leading-relaxed mb-4">{t.description}</p>
                                        {t.notice && (
                                            <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl flex gap-2 items-start mb-4">
                                                <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                                                <p className="text-[10px] text-amber-500/80 leading-tight">{t.notice}</p>
                                            </div>
                                        )}
                                    </div>
                                    <button onClick={() => handleSelectTemplate(key)} className="w-full py-4 bg-neutral-800 hover:bg-cyan-600 text-neutral-400 hover:text-white text-xs font-bold transition-all flex items-center justify-center gap-2 border-t border-neutral-800">開始專業代寫 <Check className="w-4 h-4" /></button>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-500">
                        <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-6 md:p-12 space-y-8 scroll-smooth">
                            <div className="mx-auto transition-all duration-300" style={{ maxWidth: `${chatWidth}px` }}>
                                {messages.length === 0 && (
                                    <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto text-center space-y-6 py-20">
                                        <div className="w-20 h-20 bg-neutral-900 rounded-3xl flex items-center justify-center border border-neutral-800 shadow-xl"><Scale className="w-10 h-10 text-cyan-500" /></div>
                                        <h2 className="text-2xl font-bold text-white">您好，{userName}</h2>
                                        <p className="text-neutral-500 text-sm leading-relaxed">您可以直接詢問法律問題，或使用語音輸入。</p>
                                    </div>
                                )}
                                {messages.map((m, i) => (
                                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300 mb-8`}>
                                        <div className="relative group max-w-[90%] md:max-w-[85%]">
                                            <div id={`msg-content-${i}`} className={`p-6 rounded-2xl prose prose-invert prose-sm shadow-2xl ${m.role === 'user' ? 'bg-cyan-600 text-white rounded-tr-none' : 'bg-neutral-900 text-neutral-200 border border-neutral-800 rounded-tl-none'}`}>
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                                            </div>
                                            <div className="absolute -right-12 top-0 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                                {m.role === 'assistant' && (
                                                    <>
                                                        <button onClick={() => exportToPDF(i)} className="p-2 text-neutral-500 hover:text-cyan-500" title="匯出為 PDF"><Download className="w-5 h-5" /></button>
                                                        <button onClick={() => speak(m.content.replace(/\[CALL:.*?\]/g, "").replace(/[#*`]/g, ""), voiceRate)} className="p-2 text-neutral-500 hover:text-orange-500" title="語音朗讀"><Volume2 className="w-5 h-5" /></button>
                                                    </>
                                                )}
                                            </div>
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

                        {/* Input Area */}
                        <div className="p-6 md:p-10 bg-gradient-to-t from-neutral-950 via-neutral-950 to-transparent">
                            <div className="mx-auto relative group transition-all duration-300" style={{ maxWidth: `${chatWidth}px` }}>
                                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-600 to-purple-600 rounded-2xl blur opacity-10 group-focus-within:opacity-30 transition-opacity" />
                                <div className="relative flex gap-3 bg-neutral-900 p-2.5 rounded-2xl border border-neutral-800 shadow-2xl items-end">
                                    <button 
                                        onClick={isListening ? stopListening : startListening}
                                        className={`p-3 rounded-xl transition-all ${isListening ? 'bg-rose-600 text-white animate-pulse' : 'bg-neutral-800 text-neutral-400 hover:text-white'}`}
                                        title={isListening ? "停止錄音" : "語音輸入"}
                                    >
                                        {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                                    </button>
                                    <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder={isLoaded ? (isListening ? "正在聆聽..." : "輸入內容或請我代寫文件...") : "請啟動 AI..."} disabled={!isLoaded || isThinking} rows={1} className="flex-1 bg-transparent border-none px-4 py-3 focus:outline-none text-white placeholder:text-neutral-600 resize-none min-h-[50px] max-h-[200px]" onInput={(e) => { const target = e.target as HTMLTextAreaElement; target.style.height = 'auto'; target.style.height = target.scrollHeight + 'px'; }} />
                                    <button onClick={handleSendMessage} disabled={isThinking || !isLoaded || !input.trim()} className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-20 p-4 rounded-xl transition-all shadow-lg hover:scale-105 active:scale-95"><Send className="w-5 h-5 text-white" /></button>
                                </div>
                                <div className="mt-3 flex flex-wrap justify-between items-center text-[8px] text-neutral-600 uppercase tracking-widest px-2 gap-4">
                                    <div className="flex items-center gap-4">
                                        <span><ShieldCheck className="inline w-2.5 h-2.5 mr-1" /> End-to-End Local Privacy</span>
                                        <span className="flex items-center gap-1.5">
                                            <Activity className="w-2.5 h-2.5" /> 
                                            總瀏覽 <span id="busuanzi_value_site_pv" className="font-bold text-neutral-500">...</span>
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <MessageSquare className="w-2.5 h-2.5" /> 
                                            本頁 <span id="busuanzi_value_page_pv" className="font-bold text-neutral-500">...</span>
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <User className="w-2.5 h-2.5" /> 
                                            訪客 <span id="busuanzi_value_site_uv" className="font-bold text-neutral-500">...</span>
                                        </span>
                                    </div>
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
