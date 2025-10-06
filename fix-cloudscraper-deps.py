#!/usr/bin/env python3
import subprocess
import sys

def fix_cloudscraper_deps():
    print("🔧 Исправляем зависимости cloudscraper...")
    
    # Устанавливаем совместимые версии
    packages = [
        "urllib3==1.26.18",
        "requests==2.31.0", 
        "cloudscraper==1.2.71"
    ]
    
    for package in packages:
        print(f"📦 Устанавливаем {package}...")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", package], check=True)
            print(f"✅ {package} установлен")
        except subprocess.CalledProcessError as e:
            print(f"❌ Ошибка установки {package}: {e}")
    
    # Проверяем установку
    try:
        import cloudscraper
        print("✅ cloudscraper успешно импортирован")
        return True
    except ImportError as e:
        print(f"❌ Ошибка импорта: {e}")
        return False

if __name__ == "__main__":
    fix_cloudscraper_deps()
