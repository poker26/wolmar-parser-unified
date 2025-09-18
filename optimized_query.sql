
            -- Оптимизированный запрос для получения лотов для обновления
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition IN ('MS', 'AU', 'XF', 'VF', 'PF', 'UNC', 'PL', 'PR', 'F', 'Proof', 'Gem', 'XX')
            ORDER BY auction_number DESC, lot_number;
        