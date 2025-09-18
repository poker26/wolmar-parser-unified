
            -- Ультра-оптимизированный запрос для получения лотов для обновления
            -- Обновляем только критичные состояния: MS, PF, UNC, PL, PR, F, Proof, Gem, XX
            -- Пропускаем VF, XF, AU - для них градации менее важны
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition IN ('MS', 'PF', 'UNC', 'PL', 'PR', 'F', 'Proof', 'Gem', 'XX')
            ORDER BY auction_number DESC, lot_number;
        