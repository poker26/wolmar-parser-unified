"""
Извлечение данных из PostgreSQL для анализа аукциона Wolmar
Использование: python wolmar_extractor.py
"""

import pandas as pd
import psycopg2

# НАСТРОЙКИ ПОДКЛЮЧЕНИЯ К БД
DB_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'database': 'your_database_name',  # <-- ИЗМЕНИТЕ
    'user': 'your_username',            # <-- ИЗМЕНИТЕ
    'password': 'your_password'         # <-- ИЗМЕНИТЕ
}

def connect_db():
    """Подключение к PostgreSQL"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        print("✅ Подключение к PostgreSQL успешно")
        return conn
    except Exception as e:
        print(f"❌ Ошибка подключения: {e}")
        return None

def extract_lots(conn, months=6):
    """Извлекает данные о лотах за последние N месяцев"""
    
    query = f"""
    SELECT 
        id,
        lot_number,
        auction_number,
        coin_description,
        winner_login,
        winning_bid,
        starting_bid,
        bids_count,
        auction_end_date,
        lot_status,
        year,
        metal,
        condition,
        category,
        lot_type,
        weight,
        currency
    FROM auction_lots
    WHERE auction_end_date >= NOW() - INTERVAL '{months} months'
        AND lot_status IS NOT NULL
        AND winner_login IS NOT NULL
    ORDER BY auction_end_date DESC;
    """
    
    print(f"\n📥 Извлечение лотов за последние {months} месяцев...")
    df = pd.read_sql_query(query, conn)
    
    print(f"✅ Извлечено лотов: {len(df)}")
    print(f"   Аукционов: {df['auction_number'].nunique()}")
    print(f"   Победителей: {df['winner_login'].nunique()}")
    
    return df

def find_repeat_buyers(conn, min_purchases=3):
    """Находит покупателей одинаковых монет"""
    
    query = f"""
    SELECT 
        winner_login,
        coin_description,
        COUNT(*) as purchase_count,
        AVG(winning_bid) as avg_price,
        STRING_AGG(DISTINCT auction_number, ', ') as auctions,
        MIN(auction_end_date) as first_purchase,
        MAX(auction_end_date) as last_purchase
    FROM auction_lots
    WHERE winner_login IS NOT NULL
        AND auction_end_date >= NOW() - INTERVAL '6 months'
    GROUP BY winner_login, coin_description
    HAVING COUNT(*) >= {min_purchases}
    ORDER BY COUNT(*) DESC;
    """
    
    print(f"\n🔍 Поиск повторных покупателей...")
    df = pd.read_sql_query(query, conn)
    
    print(f"✅ Найдено: {len(df)} случаев")
    
    if len(df) > 0:
        print("\n⚠️  ТОП-10 ПОДОЗРИТЕЛЬНЫХ:")
        for idx, row in df.head(10).iterrows():
            print(f"\n   {row['winner_login']}:")
            print(f"      Монета: {row['coin_description'][:60]}")
            print(f"      Покупок: {row['purchase_count']}")
            print(f"      Средняя цена: {row['avg_price']:.2f} RUB")
    
    return df

def analyze_concentration(conn, min_lots=5):
    """Анализирует концентрацию побед в одном аукционе"""
    
    query = f"""
    SELECT 
        auction_number,
        winner_login,
        COUNT(*) as lots_won,
        SUM(winning_bid) as total_spent,
        COUNT(DISTINCT category) as categories
    FROM auction_lots
    WHERE winner_login IS NOT NULL
    GROUP BY auction_number, winner_login
    HAVING COUNT(*) >= {min_lots}
    ORDER BY COUNT(*) DESC;
    """
    
    print(f"\n📦 Анализ концентрации побед...")
    df = pd.read_sql_query(query, conn)
    
    print(f"✅ Найдено: {len(df)} случаев массовых покупок")
    
    return df

def main():
    """Главная функция"""
    
    print("="*60)
    print("📊 ИЗВЛЕЧЕНИЕ ДАННЫХ ИЗ WOLMAR БД")
    print("="*60)
    
    # Подключение
    conn = connect_db()
    if not conn:
        return
    
    # Создаем папку для данных
    import os
    os.makedirs('data', exist_ok=True)
    
    # 1. Основные данные лотов
    lots_df = extract_lots(conn, months=6)
    lots_df.to_csv('data/wolmar_lots.csv', index=False, encoding='utf-8')
    print("💾 Сохранено: data/wolmar_lots.csv")
    
    # 2. Повторные покупатели
    repeat_df = find_repeat_buyers(conn, min_purchases=3)
    repeat_df.to_csv('data/repeat_buyers.csv', index=False, encoding='utf-8')
    print("💾 Сохранено: data/repeat_buyers.csv")
    
    # 3. Концентрация побед
    concentration_df = analyze_concentration(conn, min_lots=5)
    concentration_df.to_csv('data/concentration.csv', index=False, encoding='utf-8')
    print("💾 Сохранено: data/concentration.csv")
    
    # Закрываем соединение
    conn.close()
    
    print("\n" + "="*60)
    print("✅ ДАННЫЕ ИЗВЛЕЧЕНЫ УСПЕШНО!")
    print("="*60)
    print("\nСледующий шаг: запустите анализ")
    print("  python wolmar_analyzer.py")

if __name__ == "__main__":
    main()
