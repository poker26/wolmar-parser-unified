/**
 * Классификатор лотов для автоматического определения категорий
 * Основан на анализе описаний и других полей лота
 */

class LotClassifier {
    constructor() {
        // Карта категорий и их ключевых слов
        this.categoryKeywords = {
            'coin': {
                keywords: [
                    'монета', 'монет', 'монеты', 'монету', 'монетой',
                    'рубль', 'рублей', 'рубля', 'рублем', 'рубле', 'рубл',
                    'копейка', 'копеек', 'копейки', 'копейкой', 'копеек',
                    'доллар', 'долларов', 'доллара', 'долларом',
                    'евро', 'франк', 'марка', 'лира', 'песо', 'центов', 'цент',
                    'аверс', 'реверс', 'гурт', 'чеканка', 'тираж',
                    'серебро', 'золото', 'медь', 'бронза', 'платина',
                    'ag', 'au', 'cu', 'br', 'pt', 'ni', 'zn', 'fe', 'al',
                    'император', 'царь', 'царская', 'царские',
                    'советский', 'советская', 'советские',
                    'российский', 'российская', 'российские',
                    'монетный двор', 'спмд', 'лмд', 'ммд', 'екатеринбург',
                    'полтина', 'полтинник', 'гривенник', 'алтын', 'деньга'
                ],
                negativeKeywords: [
                    'банкнот', 'купюр', 'жетон', 'медаль', 'орден', 'знак', 'бумага'
                ]
            },
            'banknote': {
                keywords: [
                    'банкнот', 'банкнота', 'банкноты', 'банкноту', 'банкнотой',
                    'купюр', 'купюра', 'купюры', 'купюру', 'купюрой',
                    'денежн', 'деньги', 'денег', 'деньгами',
                    'рублев', 'долларов', 'евро', 'франков',
                    'государственн', 'казначейск', 'эмиссионн'
                ],
                negativeKeywords: [
                    'монет', 'жетон', 'медаль', 'орден'
                ]
            },
            'token': {
                keywords: [
                    'жетон', 'жетона', 'жетоны', 'жетону', 'жетоном',
                    'жетоны', 'жетонов', 'жетонами',
                    'марка', 'марки', 'марку', 'маркой',
                    'пластинка', 'пластинки', 'пластинку', 'пластинкой',
                    'металлическ', 'кругл', 'квадратн'
                ],
                negativeKeywords: [
                    'монет', 'банкнот', 'медаль', 'орден'
                ]
            },
            'medal': {
                keywords: [
                    'медаль', 'медали', 'медалью', 'медалями',
                    'медальон', 'медальона', 'медальоны', 'медальоном',
                    'памятн', 'юбилейн', 'наградн',
                    'чеканк', 'отливк', 'штамповк'
                ],
                negativeKeywords: [
                    'монет', 'банкнот', 'жетон', 'орден'
                ]
            },
            'badge': {
                keywords: [
                    'орден', 'ордена', 'орденом', 'орденами',
                    'знак', 'знака', 'знаки', 'знаком', 'знаками',
                    'наград', 'награда', 'награды', 'наградой', 'наградами',
                    'значок', 'значка', 'значки', 'значком', 'значками',
                    'эмаль', 'эмали', 'эмалью', 'эмалями',
                    'финифт', 'финифти', 'финифтью'
                ],
                negativeKeywords: [
                    'монет', 'банкнот', 'жетон', 'медаль'
                ]
            },
            'jewelry': {
                keywords: [
                    'кольцо', 'кольца', 'кольцом', 'кольцами',
                    'серьги', 'серьгами', 'серьгой',
                    'браслет', 'браслета', 'браслеты', 'браслетом', 'браслетами',
                    'цепочка', 'цепочки', 'цепочку', 'цепочкой', 'цепочками',
                    'кулон', 'кулона', 'кулоны', 'кулоном', 'кулонами',
                    'подвеска', 'подвески', 'подвеску', 'подвеской', 'подвесками',
                    'ювелирн', 'драгоценн', 'украшен'
                ],
                negativeKeywords: [
                    'монет', 'банкнот', 'жетон', 'медаль', 'орден'
                ]
            }
        };

        // Веса для разных полей
        this.fieldWeights = {
            'coin_description': 1.0,
            'letters': 0.8,
            'lot_type': 0.6,
            'metal': 0.4
        };
    }

    /**
     * Классифицирует лот и возвращает наиболее вероятную категорию
     * @param {Object} lot - объект лота
     * @returns {string|null} - категория или null если не удалось определить
     */
    classify(lot) {
        if (!lot) return null;

        const scores = {};
        
        // Инициализируем счетчики для всех категорий
        Object.keys(this.categoryKeywords).forEach(category => {
            scores[category] = 0;
        });

        // Анализируем каждое поле лота
        Object.entries(this.fieldWeights).forEach(([field, weight]) => {
            const fieldValue = lot[field];
            if (!fieldValue) return;

            const text = String(fieldValue).toLowerCase();
            
            // Подсчитываем очки для каждой категории
            Object.entries(this.categoryKeywords).forEach(([category, config]) => {
                let categoryScore = 0;
                
                // Положительные ключевые слова
                config.keywords.forEach(keyword => {
                    if (text.includes(keyword.toLowerCase())) {
                        categoryScore += 1;
                    }
                });
                
                // Отрицательные ключевые слова (штраф)
                config.negativeKeywords.forEach(keyword => {
                    if (text.includes(keyword.toLowerCase())) {
                        categoryScore -= 2; // Больший штраф за отрицательные слова
                    }
                });
                
                scores[category] += categoryScore * weight;
            });
        });

        // Специальные правила для улучшения классификации
        this.applySpecialRules(lot, scores);

        // Находим категорию с максимальным счетом
        let maxScore = 0;
        let bestCategory = null;

        Object.entries(scores).forEach(([category, score]) => {
            if (score > maxScore) {
                maxScore = score;
                bestCategory = category;
            }
        });

        // Возвращаем категорию только если счет достаточно высокий
        return maxScore >= 1.0 ? bestCategory : null;
    }

    /**
     * Применяет специальные правила для улучшения классификации
     * @param {Object} lot - объект лота
     * @param {Object} scores - объект со счетами категорий
     */
    applySpecialRules(lot, scores) {
        const description = String(lot.coin_description || '').toLowerCase();
        const metal = String(lot.metal || '').toLowerCase();
        const letters = String(lot.letters || '').toLowerCase();

        // Правило 1: Если есть металл (Ag, Au, Cu, etc.) и номинал в описании - скорее всего монета
        const metalSymbols = ['ag', 'au', 'cu', 'br', 'pt', 'ni', 'zn', 'fe', 'al'];
        const hasMetalSymbol = metalSymbols.some(symbol => metal.includes(symbol));
        const hasDenomination = /(\d+\s*(рубл|копе|доллар|евро|франк|марк|лир|песо|цент))/i.test(description);
        
        if (hasMetalSymbol && hasDenomination) {
            scores.coin += 2.0; // Дополнительные очки за монету
        }

        // Правило 2: Если есть монетный двор в буквах - скорее всего монета
        const mintMarks = ['спмд', 'лмд', 'ммд', 'екатеринбург', 'московский'];
        const hasMintMark = mintMarks.some(mark => letters.includes(mark.toLowerCase()));
        
        if (hasMintMark) {
            scores.coin += 1.5;
        }

        // Правило 3: Если есть "бумага" в описании - скорее всего банкнота
        if (description.includes('бумага') || description.includes('бумажн')) {
            scores.banknote += 2.0;
            scores.coin -= 1.0; // Штраф для монеты
        }

        // Правило 4: Если есть "жетон" - точно жетон
        if (description.includes('жетон')) {
            scores.token += 3.0;
        }

        // Правило 5: Если есть "медаль" - точно медаль
        if (description.includes('медаль')) {
            scores.medal += 3.0;
        }

        // Правило 6: Если есть "орден" или "знак" - скорее всего знак/орден
        if (description.includes('орден') || description.includes('знак')) {
            scores.badge += 2.0;
        }

        // Правило 7: Если есть ювелирные термины - скорее всего украшение
        const jewelryTerms = ['кольцо', 'серьги', 'браслет', 'цепочка', 'кулон', 'подвеска'];
        const hasJewelryTerm = jewelryTerms.some(term => description.includes(term));
        
        if (hasJewelryTerm) {
            scores.jewelry += 2.0;
        }
    }

    /**
     * Классифицирует лот с детальной информацией
     * @param {Object} lot - объект лота
     * @returns {Object} - результат классификации с деталями
     */
    classifyDetailed(lot) {
        if (!lot) return { category: null, confidence: 0, scores: {} };

        const scores = {};
        
        // Инициализируем счетчики для всех категорий
        Object.keys(this.categoryKeywords).forEach(category => {
            scores[category] = 0;
        });

        const fieldAnalysis = {};

        // Анализируем каждое поле лота
        Object.entries(this.fieldWeights).forEach(([field, weight]) => {
            const fieldValue = lot[field];
            if (!fieldValue) return;

            const text = String(fieldValue).toLowerCase();
            fieldAnalysis[field] = {
                value: fieldValue,
                text: text,
                matches: {}
            };
            
            // Подсчитываем очки для каждой категории
            Object.entries(this.categoryKeywords).forEach(([category, config]) => {
                let categoryScore = 0;
                const matches = [];
                
                // Положительные ключевые слова
                config.keywords.forEach(keyword => {
                    if (text.includes(keyword.toLowerCase())) {
                        categoryScore += 1;
                        matches.push(`+${keyword}`);
                    }
                });
                
                // Отрицательные ключевые слова (штраф)
                config.negativeKeywords.forEach(keyword => {
                    if (text.includes(keyword.toLowerCase())) {
                        categoryScore -= 2;
                        matches.push(`-${keyword}`);
                    }
                });
                
                scores[category] += categoryScore * weight;
                fieldAnalysis[field].matches[category] = matches;
            });
        });

        // Находим категорию с максимальным счетом
        let maxScore = 0;
        let bestCategory = null;

        Object.entries(scores).forEach(([category, score]) => {
            if (score > maxScore) {
                maxScore = score;
                bestCategory = category;
            }
        });

        // Вычисляем уверенность (от 0 до 1)
        const totalPossibleScore = Object.values(this.fieldWeights).reduce((sum, weight) => sum + weight, 0) * 3; // Примерно 3 ключевых слова на поле
        const confidence = Math.min(maxScore / totalPossibleScore, 1.0);

        return {
            category: maxScore >= 1.0 ? bestCategory : null,
            confidence: confidence,
            scores: scores,
            fieldAnalysis: fieldAnalysis,
            maxScore: maxScore
        };
    }

    /**
     * Получает список всех доступных категорий
     * @returns {Array} - массив категорий
     */
    getAvailableCategories() {
        return Object.keys(this.categoryKeywords);
    }

    /**
     * Получает ключевые слова для категории
     * @param {string} category - название категории
     * @returns {Object} - объект с ключевыми словами
     */
    getCategoryKeywords(category) {
        return this.categoryKeywords[category] || null;
    }
}

module.exports = LotClassifier;
