export const tool_getTime = () => {
    return new Date().toLocaleString('zh-TW', { hour12: false }) + " (本地時間)";
};

export const tool_searchLaw = async (query: string) => {
    try {
        const encoded = encodeURIComponent(query + " 台灣法律");
        // Using Wikipedia API as a source for legal concepts/terms in Taiwan
        const resp = await fetch(`https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&format=json&origin=*`);
        const data = await resp.json();
        
        if (!data.query || !data.query.search) return "查無相關法規紀錄。";
        
        const results = data.query.search.slice(0, 3).map((r: any) => 
            `【${r.title}】\n${r.snippet.replace(/<[^>]+>/g, '')}`
        );
        
        return results.join('\n\n') || "查無相關法規紀錄。";
    } catch (e) {
        console.error("Tool searchLaw Error:", e);
        return "網路搜尋失敗";
    }
};

export const tool_runMath = (expr: string) => {
    try {
        // Simple sanitization for a draft math evaluator
        const sanitized = expr.replace(/[^-()\d/*+.]/g, '');
        // eslint-disable-next-line no-eval
        return eval(sanitized).toString();
    } catch (e) {
        return "計算錯誤";
    }
};
