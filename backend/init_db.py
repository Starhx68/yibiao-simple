"""数据库初始化脚本"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine, Base, SessionLocal
from app.models.models import User, CompanyInfo, Qualification, Personnel, FinancialInfo, Performance
from app.services.auth_service import get_password_hash

def init_database():
    print("正在创建数据库表...")
    Base.metadata.create_all(bind=engine)
    print("数据库表创建完成！")
    
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").first()
        if not admin:
            print("正在创建管理员用户...")
            admin_user = User(
                username="admin",
                password_hash=get_password_hash("admin$123"),
                role="admin",
                real_name="系统管理员",
                is_active=True
            )
            db.add(admin_user)
            db.commit()
            print("管理员用户创建成功！")
            print("=" * 50)
            print("用户名: admin")
            print("密码: admin$123")
            print("=" * 50)
        else:
            print("管理员用户已存在")
    finally:
        db.close()

if __name__ == "__main__":
    init_database()
