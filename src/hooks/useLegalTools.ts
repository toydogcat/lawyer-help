export const tool_getTime = () => {
    return new Date().toLocaleString('zh-TW', { hour12: false }) + " (本地時間)";
};

export const tool_searchLaw = async (query: string) => {
    try {
        // 1. Try local mock database first (for demo/fast-validation of core laws)
        try {
            const mockResp = await fetch('/laws_mock.json');
            const mockData = await mockResp.json();
            // Remove spaces and normalize query for matching
            const normalizedQuery = query.replace(/\s+/g, '');
            for (const key in mockData) {
                if (normalizedQuery.includes(key) || key.includes(normalizedQuery)) {
                    return `【${key}】\n${mockData[key]}`;
                }
            }
        } catch (e) {
            console.warn("Local mock DB fetch failed or not found", e);
        }

        // 2. Fallback to Wikipedia API
        const encoded = encodeURIComponent(query + " 台灣法律");
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
