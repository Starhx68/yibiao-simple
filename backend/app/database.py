"""数据库配置"""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://root:Fog55han!@localhost:3306/hxybs")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def _ensure_schema():
    insp = inspect(engine)
    dialect_name = engine.dialect.name
    schema_map = {
        "company_info": [
            ("legal_person_id_number", "VARCHAR(50)"),
            ("authorized_person", "VARCHAR(50)"),
            ("authorized_person_id_number", "VARCHAR(50)"),
            ("authorized_person_phone", "VARCHAR(30)"),
            ("bank_branch", "VARCHAR(200)"),
            ("bank_account_name", "VARCHAR(200)"),
            ("bank_address", "VARCHAR(500)"),
            ("company_type", "VARCHAR(100)"),
            ("operating_period_start", "DATE"),
            ("operating_period_end", "DATE"),
            ("operating_period_long_term", "BOOLEAN DEFAULT FALSE"),
            ("postal_code", "VARCHAR(20)"),
            ("registration_authority", "VARCHAR(200)"),
            ("legal_person_gender", "VARCHAR(10)"),
            ("legal_person_birth_date", "DATE"),
            ("legal_person_id_card_url", "VARCHAR(500)"),
            ("legal_person_id_valid_from", "DATE"),
            ("legal_person_id_valid_to", "DATE"),
            ("legal_person_id_long_term", "BOOLEAN DEFAULT FALSE"),
            ("legal_person_position", "VARCHAR(100)"),
            ("authorized_person_gender", "VARCHAR(10)"),
            ("authorized_person_birth_date", "DATE"),
            ("authorized_person_id_card_url", "VARCHAR(500)"),
            ("authorized_person_id_valid_from", "DATE"),
            ("authorized_person_id_valid_to", "DATE"),
            ("authorized_person_id_long_term", "BOOLEAN DEFAULT FALSE"),
            ("authorized_person_position", "VARCHAR(100)"),
            ("bank_license_url", "VARCHAR(500)"),
            ("bank_code", "VARCHAR(50)"),
            ("bank_phone", "VARCHAR(30)"),
            ("product_and_function", "TEXT"),
            ("brand_resource_capability", "TEXT"),
            ("personnel_technical_capability", "TEXT"),
            ("related_image_url", "VARCHAR(500)"),
        ],
        "qualifications": [
            ("valid_long_term", "BOOLEAN DEFAULT FALSE"),
        ],
        "personnel": [
            ("age", "INTEGER"),
            ("birth_date", "DATE"),
            ("id_valid_from", "DATE"),
            ("id_valid_to", "DATE"),
            ("id_long_term", "BOOLEAN DEFAULT FALSE"),
            ("title", "VARCHAR(100)"),
            ("status", "VARCHAR(50)"),
            ("start_work_date", "DATE"),
            ("profile", "TEXT"),
            ("cert_level", "VARCHAR(50)"),
            ("cert_major", "VARCHAR(100)"),
            ("cert_valid_from", "DATE"),
            ("cert_long_term", "BOOLEAN DEFAULT FALSE"),
            ("id_card_url", "VARCHAR(500)"),
            ("education_cert_url", "VARCHAR(500)"),
            ("contract_url", "VARCHAR(500)"),
            ("driver_license_url", "VARCHAR(500)"),
            ("social_security_url", "VARCHAR(500)"),
        ],
        "performances": [
            ("project_number", "VARCHAR(100)"),
            ("package_number", "VARCHAR(100)"),
            ("client_type", "VARCHAR(100)"),
            ("project_manager", "VARCHAR(50)"),
            ("bid_notice_url", "VARCHAR(500)"),
            ("evaluation_url", "VARCHAR(500)"),
            ("invoice_url", "VARCHAR(500)"),
        ],
        "business_bid_projects": [
            ("elements_content", "TEXT"),
            ("directories_content", "TEXT"),
        ],
        "technical_bid_library": [
            ("total_pages", "INTEGER DEFAULT 0"),
            ("summary_chunks", "INTEGER DEFAULT 0"),
            ("processing_started_at", "DATETIME"),
            ("processing_completed_at", "DATETIME"),
            ("processing_duration", "INTEGER"),
            ("industry_tags", "JSON"),
            ("project_type_tags", "JSON"),
        ],
        "rag_industry_categories": [
            ("sort_order", "INTEGER DEFAULT 0"),
            ("enabled", "BOOLEAN DEFAULT TRUE"),
            ("keywords", "JSON"),
        ],
        "rag_project_type_categories": [
            ("sort_order", "INTEGER DEFAULT 0"),
            ("enabled", "BOOLEAN DEFAULT TRUE"),
            ("keywords", "JSON"),
        ],
    }

    with engine.begin() as conn:
        for table_name, columns in schema_map.items():
            if not insp.has_table(table_name):
                continue
            existing = {col["name"] for col in insp.get_columns(table_name)}
            for name, ddl_type in columns:
                if name in existing:
                    continue
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {name} {ddl_type}"))

        if dialect_name == "mysql" and insp.has_table("performances"):
            performance_columns = {col["name"]: col for col in insp.get_columns("performances")}
            text_columns = {
                "completion_status": "TEXT",
                "acceptance_status": "TEXT",
            }
            for name, ddl_type in text_columns.items():
                column = performance_columns.get(name)
                if not column:
                    continue
                current_type = str(column.get("type", "")).upper()
                if "TEXT" in current_type:
                    continue
                conn.execute(text(f"ALTER TABLE performances MODIFY COLUMN {name} {ddl_type}"))

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    global engine, SessionLocal
    try:
        Base.metadata.create_all(bind=engine)
        _ensure_schema()
    except Exception as e:
        fallback_url = os.getenv("SQLITE_FALLBACK_URL")
        if not fallback_url:
            raise
        engine = create_engine(fallback_url, connect_args={"check_same_thread": False})
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        _ensure_schema()
        print(f"[database] Primary DB init failed: {e}. Fallback to SQLite at {fallback_url}")
