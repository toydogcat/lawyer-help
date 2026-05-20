import React, { useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { Upload, Loader2 } from 'lucide-react';

// Set worker source for pdfjs - using a stable version
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface FileIngestionProps {
    onTextExtracted: (text: string, fileName: string) => void;
    isProcessing: boolean;
}

export const FileIngestion: React.FC<FileIngestionProps> = ({ onTextExtracted, isProcessing }) => {
    const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const arrayBuffer = event.target?.result as ArrayBuffer;
            try {
                const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
                let fullText = "";
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    const strings = content.items.map((item: any) => (item as any).str);
                    fullText += strings.join(" ") + "\n";
                }
                onTextExtracted(fullText, file.name);
            } catch (err) {
                console.error("PDF Parsing Error:", err);
                alert("PDF 解析失敗");
            }
        };
        reader.readAsArrayBuffer(file);
    }, [onTextExtracted]);

    return (
        <div className="relative group">
            <input
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                disabled={isProcessing}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <div className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-2xl transition-all ${
                isProcessing 
                ? 'border-cyan-500/20 bg-cyan-500/5' 
                : 'border-neutral-800 group-hover:border-cyan-500/50 group-hover:bg-cyan-500/5'
            }`}>
                {isProcessing ? (
                    <Loader2 className="w-8 h-8 text-cyan-500 animate-spin mb-2" />
                ) : (
                    <Upload className="w-8 h-8 text-neutral-500 group-hover:text-cyan-500 mb-2 transition-colors" />
                )}
                <p className="text-sm font-medium text-neutral-400 group-hover:text-neutral-200">
                    {isProcessing ? "正在分析文檔..." : "上傳 PDF 法律文件"}
                </p>
                <p className="text-xs text-neutral-600 mt-1">支援本地 RAG 檢索</p>
            </div>
        </div>
    );
};
