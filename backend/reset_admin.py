"""重置管理员密码脚本"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from database import SessionLocal, init_db
from app.models.models import User

init_db()
db = SessionLocal()

# 检查是否有管理员用户
user = db.query(User).filter(User.username == 'admin').first()

if user:
    # 使用 bcrypt 直接设置密码哈希
    import bcrypt
    password = 'admin$123'.encode('utf-8')
    user.password_hash = bcrypt.hashpw(password, bcrypt.gensalt()).decode('utf-8')
    db.commit()
    print('管理员密码已重置成功！')
    print('用户名: admin')
    print('密码: admin$123')
else:
    # 创建管理员用户
    import bcrypt
    password = 'admin$123'.encode('utf-8')
    admin_user = User(
        username='admin',
        password_hash=bcrypt.hashpw(password, bcrypt.gensalt()).decode('utf-8'),
        role='admin',
        real_name='系统管理员',
        is_active=True
    )
    db.add(admin_user)
    db.commit()
    print('管理员用户创建成功！')
    print('用户名: admin')
    print('密码: admin$123')

db.close()
