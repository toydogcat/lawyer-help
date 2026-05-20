import { useState, useCallback } from 'react';
import { pipeline } from '@xenova/transformers';

export interface VectorChunk {
    id: number;
    text: string;
    embedding: number[];
    source: string;
}

export function useEmbedding() {
    const [isIndexing, setIsIndexing] = useState(false);

    const getEmbedding = async (text: string) => {
        const embedder = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');
        const output = await embedder(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data) as number[];
    };

    const cosineSimilarity = (vecA: number[], vecB: number[]) => {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    };

    const indexDocument = useCallback(async (text: string, fileName: string): Promise<VectorChunk[]> => {
        setIsIndexing(true);
        try {
            const chunks = text.match(/[^。！？\n]+[。！？\n]*/g) || [text];
            const embedder = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');
            
            const vectorChunks: VectorChunk[] = [];
            for (let i = 0; i < chunks.length; i++) {
                const chunkText = chunks[i].trim();
                if (chunkText.length < 10) continue;
                
                const output = await embedder(chunkText, { pooling: 'mean', normalize: true });
                vectorChunks.push({
                    id: i,
                    text: chunkText,
                    embedding: Array.from(output.data) as number[],
                    source: fileName
                });
            }
            return vectorChunks;
        } finally {
            setIsIndexing(false);
        }
    }, []);

    return { indexDocument, getEmbedding, cosineSimilarity, isIndexing };
}
