"""
Анализ манипуляций на аукционе Wolmar
Использование: python wolmar_analyzer.py
"""

import pandas as pd
import numpy as np

def analyze_circular_buyers(lots_df, min_purchases=3):
    """
    Анализ круговых покупок - пользователи покупают одинаковые монеты многократно
    """
    
    print("\n" + "="*60)
    print("🔍 АНАЛИЗ 1: КРУГОВЫЕ ПОКУПКИ")
    print("="*60)
    
    results = []
    
    # Группируем по покупателю и монете
    grouped = lots_df.groupby(['winner_login', 'coin_description'])
    
    for (winner, coin), group in grouped:
        purchases = len(group)
        
        if purchases >= min_purchases:
            # Вычисляем временной промежуток
            dates = pd.to_datetime(group['auction_end_date'])
            time_span_weeks = (dates.max() - dates.min()).days / 7
            
            # Статистика
            avg_price = group['winning_bid'].mean()
            total_spent = group['winning_bid'].sum()
            avg_competition = group['bids_count'].mean()
            
            # Разброс цен
            price_std = group['winning_bid'].std()
            price_variance = (price_std / avg_price * 100) if avg_price > 0 else 0
            
            # Индекс подозрительности
            suspicion = calculate_suspicion(purchases, time_span_weeks, 
                                           avg_competition, price_variance)
            
            results.append({
                'winner_login': winner,
                'coin_description': coin[:80],
                'purchase_count': purchases,
                'weeks_span': round(time_span_weeks, 1),
                'avg_price': round(avg_price, 2),
                'total_spent': round(total_spent, 2),
                'avg_competition': round(avg_competition, 1),
                'price_variance_pct': round(price_variance, 1),
                'suspicion_score': round(suspicion, 1)
            })
    
    df_results = pd.DataFrame(results).sort_values('suspicion_score', ascending=False)
    
    print(f"\n✅ Найдено подозрительных паттернов: {len(df_results)}")
    
    if len(df_results) > 0:
        print(f"\n⚠️  ТОП-10 ПОДОЗРИТЕЛЬНЫХ:")
        print(df_results[['winner_login', 'coin_description', 'purchase_count', 
                         'suspicion_score']].head(10).to_string(index=False))
    
    return df_results

def calculate_suspicion(count, weeks, competition, price_var):
    """Вычисляет индекс подозрительности"""
    score = 0
    
    # Базовый балл за количество
    score += count * 15
    
    # Бонус за частоту
    if weeks > 0:
        frequency = count / weeks
        score += frequency * 10
    
    # Низкая конкуренция подозрительна
    if competition < 5:
        score += (5 - competition) * 5
    
    # Стабильность цен подозрительна
    if price_var < 10:
        score += 20
    
    return score

def analyze_dominators(lots_df, min_wins=10):
    """
    Анализ доминирующих победителей
    """
    
    print("\n" + "="*60)
    print("🏆 АНАЛИЗ 2: ДОМИНИРУЮЩИЕ ПОБЕДИТЕЛИ")
    print("="*60)
    
    # Статистика по победителям
    stats = lots_df.groupby('winner_login').agg({
        'lot_number': 'count',
        'auction_number': 'nunique',
        'winning_bid': ['mean', 'sum'],
        'bids_count': 'mean',
        'category': 'nunique'
    }).reset_index()
    
    stats.columns = ['winner_login', 'total_wins', 'auctions_participated',
                    'avg_winning_bid', 'total_spent', 'avg_competition',
                    'categories_won']
    
    # Фильтруем активных
    stats = stats[stats['total_wins'] >= min_wins]
    
    # Побед на аукцион
    stats['wins_per_auction'] = stats['total_wins'] / stats['auctions_participated']
    
    # Классификация
    stats['level'] = stats['wins_per_auction'].apply(lambda x:
        'CRITICAL' if x >= 10 else
        'HIGH' if x >= 5 else
        'MEDIUM' if x >= 2 else 'NORMAL'
    )
    
    stats = stats.sort_values('total_wins', ascending=False)
    
    print(f"\n✅ Активных победителей: {len(stats)}")
    
    critical = stats[stats['level'] == 'CRITICAL']
    if len(critical) > 0:
        print(f"\n⚠️  КРИТИЧЕСКИЕ ДОМИНАТОРЫ ({len(critical)}):")
        print(critical[['winner_login', 'total_wins', 'wins_per_auction']].head(10).to_string(index=False))
    
    return stats

def analyze_concentration(lots_df, min_lots=5):
    """
    Анализ концентрации - массовые покупки в одном аукционе
    """
    
    print("\n" + "="*60)
    print("📦 АНАЛИЗ 3: КОНЦЕНТРАЦИЯ ПОБЕД")
    print("="*60)
    
    # Группируем по аукциону и победителю
    conc = lots_df.groupby(['auction_number', 'winner_login']).agg({
        'lot_number': 'count',
        'winning_bid': ['sum', 'mean'],
        'category': 'nunique'
    }).reset_index()
    
    conc.columns = ['auction_number', 'winner_login', 'lots_won',
                    'total_spent', 'avg_price', 'unique_categories']
    
    conc = conc[conc['lots_won'] >= min_lots].sort_values('lots_won', ascending=False)
    
    print(f"\n✅ Случаев массовых покупок: {len(conc)}")
    
    if len(conc) > 0:
        print(f"\n⚠️  ТОП-10:")
        print(conc[['auction_number', 'winner_login', 'lots_won', 'total_spent']].head(10).to_string(index=False))
    
    return conc

def create_report(circular_df, dominators_df, concentration_df, lots_df):
    """Создает текстовый отчет"""
    
    with open('wolmar_report.txt', 'w', encoding='utf-8') as f:
        f.write("="*70 + "\n")
        f.write("ОТЧЕТ ПО АНАЛИЗУ МАНИПУЛЯЦИЙ НА АУКЦИОНЕ WOLMAR\n")
        f.write("="*70 + "\n\n")
        
        f.write(f"Дата анализа: {pd.Timestamp.now()}\n")
        f.write(f"Период: {lots_df['auction_end_date'].min()} - {lots_df['auction_end_date'].max()}\n")
        f.write(f"Всего лотов: {len(lots_df)}\n")
        f.write(f"Всего аукционов: {lots_df['auction_number'].nunique()}\n")
        f.write(f"Всего победителей: {lots_df['winner_login'].nunique()}\n\n")
        
        # Круговые покупки
        f.write("-"*70 + "\n")
        f.write("1. КРУГОВЫЕ ПОКУПКИ\n")
        f.write("-"*70 + "\n")
        if len(circular_df) > 0:
            f.write(f"\nНайдено: {len(circular_df)} подозрительных паттернов\n\n")
            f.write("ТОП-20:\n")
            f.write(circular_df.head(20).to_string(index=False))
        else:
            f.write("\nПодозрительных паттернов не обнаружено.\n")
        
        # Доминаторы
        f.write("\n\n" + "-"*70 + "\n")
        f.write("2. ДОМИНИРУЮЩИЕ ПОБЕДИТЕЛИ\n")
        f.write("-"*70 + "\n")
        critical = dominators_df[dominators_df['level'] == 'CRITICAL']
        if len(critical) > 0:
            f.write(f"\nКритические: {len(critical)}\n\n")
            f.write(critical.to_string(index=False))
        
        # Концентрация
        f.write("\n\n" + "-"*70 + "\n")
        f.write("3. КОНЦЕНТРАЦИЯ В АУКЦИОНАХ\n")
        f.write("-"*70 + "\n")
        if len(concentration_df) > 0:
            f.write(f"\nМассовых покупок: {len(concentration_df)}\n\n")
            f.write(concentration_df.head(20).to_string(index=False))
        
        # Рекомендации
        f.write("\n\n" + "="*70 + "\n")
        f.write("РЕКОМЕНДАЦИИ\n")
        f.write("="*70 + "\n\n")
        
        f.write("ДЛЯ ПОКУПАТЕЛЕЙ:\n")
        f.write("1. Проверяйте историю победителя в архиве\n")
        f.write("2. Если участник покупает одинаковые монеты 3+ раз - это продавец\n")
        f.write("3. Используйте снайперскую тактику (ставка в последние секунды)\n")
        f.write("4. Установите жесткий лимит цены ДО торгов\n\n")
        
        f.write("ДЛЯ ПЛАТФОРМЫ:\n")
        f.write("1. Показывать статистику победителя на странице лота\n")
        f.write("2. Флагировать пользователей с 5+ покупками одной монеты\n")
        f.write("3. Требовать верификацию при 10+ победах в месяц\n")
        f.write("4. Ограничить количество побед в одном аукционе\n")
    
    print("\n✅ Отчет сохранен: wolmar_report.txt")

def main():
    """Главная функция"""
    
    print("="*70)
    print("🚀 ЗАПУСК АНАЛИЗА МАНИПУЛЯЦИЙ")
    print("="*70)
    
    # Загрузка данных
    print("\n📂 Загрузка данных...")
    try:
        lots_df = pd.read_csv('data/wolmar_lots.csv')
        print(f"✅ Загружено {len(lots_df)} лотов")
    except FileNotFoundError:
        print("❌ Файл data/wolmar_lots.csv не найден!")
        print("Сначала запустите: python wolmar_extractor.py")
        return
    
    # Все анализы
    circular = analyze_circular_buyers(lots_df, min_purchases=3)
    dominators = analyze_dominators(lots_df, min_wins=10)
    concentration = analyze_concentration(lots_df, min_lots=5)
    
    # Создание отчета
    print("\n📝 Создание отчета...")
    create_report(circular, dominators, concentration, lots_df)
    
    # Сохранение результатов
    import os
    os.makedirs('results', exist_ok=True)
    
    circular.to_csv('results/circular_buyers.csv', index=False)
    dominators.to_csv('results/dominators.csv', index=False)
    concentration.to_csv('results/concentration.csv', index=False)
    
    print("\n" + "="*70)
    print("✅ АНАЛИЗ ЗАВЕРШЕН")
    print("="*70)
    print("\n📊 Результаты:")
    print("   - wolmar_report.txt (текстовый отчет)")
    print("   - results/circular_buyers.csv")
    print("   - results/dominators.csv")
    print("   - results/concentration.csv")

if __name__ == "__main__":
    main()
