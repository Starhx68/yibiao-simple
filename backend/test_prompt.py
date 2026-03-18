import asyncio
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.models import BusinessBidProject
from app.services.openai_service import OpenAIService

async def main():
    engine=create_engine('sqlite:///./app.db')
    SessionLocal=sessionmaker(bind=engine)
    db=SessionLocal()
    p=db.query(BusinessBidProject).order_by(BusinessBidProject.created_at.desc()).first()
    s = OpenAIService()
    user_prompt = f"请分析以下招标文件内容，提取商务相关要素：\n\n{p.tender_content[:150000]}"
    
    system_prompt = """你是一名专业的招标文件商务标分析师，擅长从复杂的招标文档中提取关键信息。
必须严格输出为JSON数组格式，结构如下：
[
  {
    "title": "投标人资格要求",
    "subcategories": [
      {
        "title": "主体资格要求",
        "items": [
          {"name": "投标人主体类型", "description": "..."}
        ]
      }
    ]
  }
]
必须直接输出JSON字符串，不能包含任何Markdown代码块标记。"""

    print("Sending prompt...")
    try:
        async for chunk in s.stream_chat_completion([{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}], temperature=0.1):
            print(chunk, end="")
    except Exception as e:
        print("ERR:", e)

asyncio.run(main())