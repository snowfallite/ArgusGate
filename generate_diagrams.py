#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор draw.io-диаграмм для проекта ArgusGate.
Производит 7 .drawio XML-файлов в каталоге diagrams/.
"""

from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path('diagrams')
OUT.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# Базовые функции построения drawio XML
# ─────────────────────────────────────────────────────────────────────────────

def _wrap(cells_xml: str, page_name: str,
          page_w: int = 1600, page_h: int = 1100) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" agent="argusgate-diploma">
  <diagram id="d1" name="{escape(page_name)}">
    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1"
                  connect="1" arrows="1" fold="1" page="1" pageScale="1"
                  pageWidth="{page_w}" pageHeight="{page_h}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
{cells_xml}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
"""


def _rect(cid, x, y, w, h, text, *, style=None) -> str:
    style = style or ('rounded=0;whiteSpace=wrap;html=1;'
                      'fillColor=#f5f5f5;strokeColor=#666666;fontSize=12;')
    return (f'<mxCell id="{cid}" value="{escape(text)}" style="{style}" '
            f'vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/>'
            f'</mxCell>')


def _ellipse(cid, x, y, w, h, text) -> str:
    style = ('ellipse;whiteSpace=wrap;html=1;'
             'fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=12;')
    return (f'<mxCell id="{cid}" value="{escape(text)}" style="{style}" '
            f'vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/>'
            f'</mxCell>')


def _actor(cid, x, y, text) -> str:
    style = ('shape=umlActor;verticalLabelPosition=bottom;labelBackgroundColor=none;'
             'verticalAlign=top;html=1;outlineConnect=0;fontSize=13;')
    return (f'<mxCell id="{cid}" value="{escape(text)}" style="{style}" '
            f'vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="40" height="60" as="geometry"/>'
            f'</mxCell>')


def _diamond(cid, x, y, w, h, text) -> str:
    style = ('rhombus;whiteSpace=wrap;html=1;'
             'fillColor=#fff2cc;strokeColor=#d6b656;fontSize=11;')
    return (f'<mxCell id="{cid}" value="{escape(text)}" style="{style}" '
            f'vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/>'
            f'</mxCell>')


def _start(cid, x, y, text='Старт') -> str:
    style = ('ellipse;whiteSpace=wrap;html=1;'
             'fillColor=#000000;strokeColor=#000000;fontColor=#FFFFFF;fontSize=11;')
    return (f'<mxCell id="{cid}" value="{escape(text)}" style="{style}" '
            f'vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="40" height="40" as="geometry"/>'
            f'</mxCell>')


def _end(cid, x, y, text='Конец') -> str:
    style = ('ellipse;whiteSpace=wrap;html=1;'
             'fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=3;fontSize=11;')
    return (f'<mxCell id="{cid}" value="{escape(text)}" style="{style}" '
            f'vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="40" height="40" as="geometry"/>'
            f'</mxCell>')


def _edge(cid, src, tgt, label='', *, dashed=False) -> str:
    dash = 'dashed=1;' if dashed else ''
    style = ('endArrow=classic;html=1;rounded=0;fontSize=11;'
             f'strokeColor=#333333;{dash}')
    return (f'<mxCell id="{cid}" value="{escape(label)}" style="{style}" '
            f'edge="1" parent="1" source="{src}" target="{tgt}">'
            f'<mxGeometry relative="1" as="geometry"/>'
            f'</mxCell>')


def _edge_xy(cid, x1, y1, x2, y2, label='', *, dashed=False) -> str:
    dash = 'dashed=1;' if dashed else ''
    style = (f'endArrow=classic;html=1;rounded=0;fontSize=11;'
             f'strokeColor=#333333;{dash}')
    return (f'<mxCell id="{cid}" value="{escape(label)}" style="{style}" '
            f'edge="1" parent="1">'
            f'<mxGeometry relative="1" as="geometry">'
            f'<mxPoint x="{x1}" y="{y1}" as="sourcePoint"/>'
            f'<mxPoint x="{x2}" y="{y2}" as="targetPoint"/>'
            f'</mxGeometry></mxCell>')


def _table(cid, x, y, w, title, rows, *, header_color='#dae8fc'):
    """ER-таблица: заголовок + строки (имя : тип)."""
    row_h = 22
    title_h = 28
    h = title_h + row_h * len(rows)
    parts = []
    # Контейнер
    parts.append(f'<mxCell id="{cid}" value="" style="rounded=0;whiteSpace=wrap;html=1;'
                 f'fillColor=#ffffff;strokeColor=#444444;" vertex="1" parent="1">'
                 f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/>'
                 f'</mxCell>')
    # Заголовок
    parts.append(f'<mxCell id="{cid}_t" value="<b>{escape(title)}</b>" '
                 f'style="text;strokeColor=#444444;fillColor={header_color};html=1;'
                 f'align=center;verticalAlign=middle;fontSize=12;fontStyle=1;'
                 f'whiteSpace=wrap;rounded=0;" vertex="1" parent="{cid}">'
                 f'<mxGeometry y="0" width="{w}" height="{title_h}" as="geometry"/>'
                 f'</mxCell>')
    # Строки
    for i, txt in enumerate(rows):
        parts.append(f'<mxCell id="{cid}_r{i}" value="{escape(txt)}" '
                     f'style="text;strokeColor=#444444;fillColor=#ffffff;align=left;'
                     f'verticalAlign=middle;spacingLeft=8;html=1;fontSize=10;'
                     f'whiteSpace=wrap;rounded=0;" vertex="1" parent="{cid}">'
                     f'<mxGeometry y="{title_h + row_h*i}" width="{w}" '
                     f'height="{row_h}" as="geometry"/></mxCell>')
    return '\n        '.join(parts), h


# ─────────────────────────────────────────────────────────────────────────────
# 1. Use Case диаграмма
# ─────────────────────────────────────────────────────────────────────────────

def diagram_use_case():
    cells = []
    # Актор
    cells.append(_actor('actor', 80, 460, 'Администратор'))

    # Граница системы
    cells.append(f'<mxCell id="boundary" value="ArgusGate" '
                 f'style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;'
                 f'strokeColor=#333333;fontSize=14;fontStyle=1;'
                 f'verticalAlign=top;spacingTop=10;" vertex="1" parent="1">'
                 f'<mxGeometry x="280" y="60" width="1100" height="900" as="geometry"/>'
                 f'</mxCell>')

    # Use cases в две колонки
    cases_left = [
        ('uc1',  'Аутентификация в Dashboard'),
        ('uc2',  'Управление сигнатурами слоя 2'),
        ('uc3',  'Управление векторами атак (Qdrant)'),
        ('uc4',  'Настройка порогов слоёв 3, 4, 5'),
        ('uc5',  'Просмотр журнала аудита'),
    ]
    cases_right = [
        ('uc6',  'Разметка событий и создание датасета'),
        ('uc7',  'Запуск дообучения LoRA'),
        ('uc8',  'Активация LoRA-адаптера'),
        ('uc9',  'Мониторинг активных сессий'),
        ('uc10', 'Принудительное завершение сессии'),
    ]
    for i, (cid, text) in enumerate(cases_left):
        cells.append(_ellipse(cid, 360, 130 + i*150, 240, 90, text))
    for i, (cid, text) in enumerate(cases_right):
        cells.append(_ellipse(cid, 960, 130 + i*150, 240, 90, text))

    # Связи актора с каждым use case
    for cid, _ in cases_left + cases_right:
        cells.append(_edge(f'e_{cid}', 'actor', cid))

    return _wrap('\n        '.join(cells), 'Use Case', page_w=1500, page_h=1050)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Концептуальная схема БД
# ─────────────────────────────────────────────────────────────────────────────

def diagram_conceptual_db():
    cells = []
    boxes = [
        ('e_req',  100, 100,  'Запрос'),
        ('e_det',  400, 100,  'Событие детекции'),
        ('e_sig',  700, 100,  'Сигнатура'),
        ('e_ds',   100, 400,  'Датасет'),
        ('e_smp',  400, 400,  'Обучающий пример'),
        ('e_job',  700, 400,  'Задача обучения'),
        ('e_mdl',  1000, 400, 'ML-модель'),
    ]
    for cid, x, y, name in boxes:
        cells.append(_rect(cid, x, y, 200, 80, name,
                           style='rounded=0;whiteSpace=wrap;html=1;'
                                 'fillColor=#d5e8d4;strokeColor=#82b366;'
                                 'fontSize=14;fontStyle=1;'))

    # Связи (концептуальные)
    rels = [
        ('e_req', 'e_det', 'порождает'),
        ('e_det', 'e_sig', 'может ссылаться'),
        ('e_ds',  'e_smp', 'содержит'),
        ('e_ds',  'e_job', 'используется'),
        ('e_job', 'e_mdl', 'создаёт'),
        ('e_det', 'e_smp', 'размечается как'),
    ]
    for i, (s, t, lbl) in enumerate(rels):
        cells.append(_edge(f'r{i}', s, t, lbl))

    return _wrap('\n        '.join(cells), 'Концептуальная схема БД',
                 page_w=1300, page_h=700)


# ─────────────────────────────────────────────────────────────────────────────
# 3. Логическая схема БД
# ─────────────────────────────────────────────────────────────────────────────

def diagram_logical_db():
    cells = []
    tables_data = [
        ('t_req', 100, 80, 'request_logs', [
            'PK  id',
            '    timestamp',
            '    request_text',
            '    response_text',
            '    session_id',
            '    provider, model',
            '    final_verdict',
            '    total_latency_ms',
        ]),
        ('t_det', 460, 80, 'detection_events', [
            'PK  id',
            'FK  request_log_id',
            '    timestamp',
            '    layer  (1..7)',
            '    verdict',
            '    score',
            '    category, matched_rule',
            '    reason, latency_ms',
            '    label (разметка)',
        ]),
        ('t_sig', 820, 80, 'signatures', [
            'PK  id (string)',
            '    name',
            '    pattern',
            '    pattern_type',
            '    category, severity',
            '    enabled',
            '    hit_count',
            '    last_triggered_at',
        ]),
        ('t_ds', 100, 540, 'training_datasets', [
            'PK  id',
            '    name, description',
            '    sample_count',
            '    train/val/test_count',
            '    categories (JSONB)',
            '    source, created_at',
        ]),
        ('t_smp', 460, 540, 'training_samples', [
            'PK  id',
            'FK  dataset_id',
            '    text',
            '    label, category',
            '    split (train/val/test)',
            '    source_event_id',
        ]),
        ('t_job', 820, 540, 'training_jobs', [
            'PK  id',
            '    status, method',
            '    base_model',
            'FK  dataset_id',
            '    hyperparameters (JSONB)',
            '    started_at, completed_at',
            '    final_metrics (JSONB)',
            '    output_model_id',
        ]),
        ('t_mdl', 1180, 540, 'ml_models', [
            'PK  id',
            '    name, type',
            '    base_model',
            '    target_layer',
            '    file_path, size_mb',
            '    metrics (JSONB)',
            '    is_active',
            'FK  training_job_id',
        ]),
    ]
    heights = {}
    for cid, x, y, title, rows in tables_data:
        xml, h = _table(cid, x, y, 300, title, rows)
        cells.append(xml)
        heights[cid] = (x, y, h)

    # Связи 1..N
    rels = [
        ('t_req',  't_det',  '1 .. *'),
        ('t_ds',   't_smp',  '1 .. *'),
        ('t_ds',   't_job',  '1 .. *'),
        ('t_job',  't_mdl',  '0 .. 1'),
    ]
    for i, (s, t, lbl) in enumerate(rels):
        cells.append(_edge(f'lr{i}', s, t, lbl))

    return _wrap('\n        '.join(cells), 'Логическая схема БД',
                 page_w=1600, page_h=1000)


# ─────────────────────────────────────────────────────────────────────────────
# 4. Физическая схема БД (PostgreSQL-типы + индексы)
# ─────────────────────────────────────────────────────────────────────────────

def diagram_physical_db():
    cells = []
    tables_data = [
        ('p_req',  80, 60, 'request_logs', [
            'PK  id : UUID',
            '    timestamp : TIMESTAMPTZ NOT NULL',
            '    request_text : TEXT NOT NULL',
            '    normalized_text : TEXT',
            '    response_text : TEXT',
            '    session_id : UUID',
            '    provider : VARCHAR(50)',
            '    model : VARCHAR(100)',
            '    input_tokens : INT',
            '    output_tokens : INT',
            '    final_verdict : VARCHAR(20)',
            '    total_latency_ms : FLOAT',
            'IDX idx_request_logs_timestamp',
            'IDX idx_request_logs_session',
            'IDX idx_request_logs_final_verdict',
        ]),
        ('p_det', 480, 60, 'detection_events', [
            'PK  id : UUID',
            'FK  request_log_id : UUID  ON DELETE CASCADE',
            '    timestamp : TIMESTAMPTZ NOT NULL',
            '    layer : INT NOT NULL',
            '    verdict : VARCHAR(20)',
            '    score : FLOAT',
            '    category : VARCHAR(50)',
            '    matched_rule : VARCHAR(100)',
            '    reason : TEXT',
            '    latency_ms : FLOAT',
            '    label : VARCHAR(20)',
            '    label_category : VARCHAR(50)',
            '    labeled_at : TIMESTAMPTZ',
            '    label_comment : TEXT',
            '    in_training_dataset_id : UUID',
            'IDX idx_detection_events_timestamp',
            'IDX idx_detection_events_layer',
            'IDX idx_detection_events_label',
            'IDX idx_detection_events_verdict',
            'IDX idx_detection_events_request_log',
        ]),
        ('p_sig', 900, 60, 'signatures', [
            'PK  id : VARCHAR(50)',
            '    name : VARCHAR(200) NOT NULL',
            '    pattern : TEXT NOT NULL',
            '    pattern_type : VARCHAR(20)',
            '    category : VARCHAR(50)',
            '    severity : VARCHAR(20)',
            '    enabled : BOOLEAN  DEFAULT TRUE',
            '    created_at : TIMESTAMPTZ',
            '    updated_at : TIMESTAMPTZ',
            '    hit_count : INT  DEFAULT 0',
            '    last_triggered_at : TIMESTAMPTZ',
            'IDX idx_signatures_category',
            'IDX idx_signatures_enabled',
        ]),
        ('p_ds', 80, 700, 'training_datasets', [
            'PK  id : UUID',
            '    name : VARCHAR(200) NOT NULL',
            '    description : TEXT',
            '    sample_count : INT',
            '    train_count : INT',
            '    val_count : INT',
            '    test_count : INT',
            '    categories : JSONB',
            '    created_at : TIMESTAMPTZ',
            '    source : VARCHAR(50)',
        ]),
        ('p_smp', 480, 700, 'training_samples', [
            'PK  id : UUID',
            'FK  dataset_id : UUID NOT NULL  ON DELETE CASCADE',
            '    text : TEXT NOT NULL',
            '    label : VARCHAR(20)',
            '    category : VARCHAR(50)',
            '    split : VARCHAR(10)',
            '    source_event_id : UUID',
            '    created_at : TIMESTAMPTZ',
            'IDX idx_training_samples_dataset',
            'IDX idx_training_samples_split',
        ]),
        ('p_job', 900, 700, 'training_jobs', [
            'PK  id : UUID',
            '    status : VARCHAR(20)',
            '    method : VARCHAR(20)',
            '    base_model : VARCHAR(200)',
            'FK  dataset_id : UUID  ON DELETE SET NULL',
            '    hyperparameters : JSONB',
            '    started_at : TIMESTAMPTZ',
            '    completed_at : TIMESTAMPTZ',
            '    duration_seconds : FLOAT',
            '    final_metrics : JSONB',
            '    log_text : TEXT',
            '    output_model_id : UUID',
            '    error_message : TEXT',
        ]),
        ('p_mdl', 1320, 700, 'ml_models', [
            'PK  id : UUID',
            '    name : VARCHAR(200) NOT NULL',
            '    type : VARCHAR(50)',
            '    base_model : VARCHAR(200)',
            '    target_layer : INT',
            '    file_path : VARCHAR(500)',
            '    size_mb : FLOAT',
            '    metrics : JSONB',
            '    is_active : BOOLEAN  DEFAULT FALSE',
            'FK  training_job_id : UUID  ON DELETE SET NULL',
            '    created_at : TIMESTAMPTZ',
        ]),
    ]
    for cid, x, y, title, rows in tables_data:
        xml, _ = _table(cid, x, y, 380, title, rows, header_color='#fad9d5')
        cells.append(xml)

    rels = [
        ('p_req',  'p_det',  '1 .. *  (CASCADE)'),
        ('p_ds',   'p_smp',  '1 .. *  (CASCADE)'),
        ('p_ds',   'p_job',  '0 .. *  (SET NULL)'),
        ('p_job',  'p_mdl',  '0 .. 1  (SET NULL)'),
    ]
    for i, (s, t, lbl) in enumerate(rels):
        cells.append(_edge(f'pr{i}', s, t, lbl))

    return _wrap('\n        '.join(cells), 'Физическая схема БД (PostgreSQL)',
                 page_w=1800, page_h=1300)


# ─────────────────────────────────────────────────────────────────────────────
# 5. Карта навигации (Sitemap)
# ─────────────────────────────────────────────────────────────────────────────

def diagram_navigation():
    cells = []
    # Корневой узел
    cells.append(_rect('n_login', 60, 400, 200, 60, '/login\nСтраница входа',
                       style='rounded=0;whiteSpace=wrap;html=1;'
                             'fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=12;'))

    cells.append(_rect('n_root', 380, 400, 220, 60, '/  (Dashboard)\nГлавная',
                       style='rounded=0;whiteSpace=wrap;html=1;'
                             'fillColor=#d5e8d4;strokeColor=#82b366;'
                             'fontSize=12;fontStyle=1;'))

    cells.append(_edge('n_e1', 'n_login', 'n_root', 'после входа'))

    # Категории
    pages = [
        # (cid, label, x, y, group_color)
        ('n_l1', '/layer/1\nНормализация',      720,  60, '#dae8fc', '#6c8ebf'),
        ('n_l2', '/layer/2\nСигнатуры',         720, 140, '#dae8fc', '#6c8ebf'),
        ('n_l3', '/layer/3\nВекторный поиск',   720, 220, '#dae8fc', '#6c8ebf'),
        ('n_l4', '/layer/4\nML-классификатор',  720, 300, '#dae8fc', '#6c8ebf'),
        ('n_l5', '/layer/5\nАнализ сессий',     720, 380, '#dae8fc', '#6c8ebf'),
        ('n_l6', '/layer/6\nВыходной поток',    720, 460, '#dae8fc', '#6c8ebf'),
        ('n_l7', '/layer/7\nМодель-судья',      720, 540, '#dae8fc', '#6c8ebf'),
        ('n_audit',    '/audit-log\nЖурнал аудита',           720, 660, '#fff2cc', '#d6b656'),
        ('n_sessions', '/active-sessions\nАктивные сессии',   720, 740, '#fff2cc', '#d6b656'),
        ('n_train',    '/datasets-training\nДатасеты и обучение', 720, 820, '#fff2cc', '#d6b656'),
        ('n_set',      '/settings\nНастройки и пороги',       720, 900, '#fff2cc', '#d6b656'),
    ]
    for cid, label, x, y, fill, stroke in pages:
        cells.append(_rect(cid, x, y, 240, 60, label,
                           style=f'rounded=0;whiteSpace=wrap;html=1;'
                                 f'fillColor={fill};strokeColor={stroke};fontSize=11;'))
        cells.append(_edge(f'ne_{cid}', 'n_root', cid))

    # Подписи групп
    cells.append(_rect('grp_lbl1', 1000,  60, 180, 30,
                       '7 страниц слоёв конвейера',
                       style='text;strokeColor=none;fillColor=none;align=left;'
                             'verticalAlign=middle;fontSize=11;fontStyle=2;'))
    cells.append(_rect('grp_lbl2', 1000, 660, 180, 30,
                       '4 страницы управления',
                       style='text;strokeColor=none;fillColor=none;align=left;'
                             'verticalAlign=middle;fontSize=11;fontStyle=2;'))

    return _wrap('\n        '.join(cells), 'Карта навигации Dashboard',
                 page_w=1300, page_h=1050)


# ─────────────────────────────────────────────────────────────────────────────
# 6. Activity-диаграмма обработки запроса
# ─────────────────────────────────────────────────────────────────────────────

def diagram_activity():
    cells = []
    swimlane_y = 60
    # Start
    cells.append(_start('a_start', 380, swimlane_y))

    # Действия 7 слоёв + ветвления
    activities = [
        # cid, y, text
        ('a_recv', 130, 'Приём запроса\n(POST /v1/chat/completions)'),
        ('a_l1',   220, 'Слой 1: Нормализация\nNFKC, омоглифы, base64'),
    ]
    for cid, y, txt in activities:
        cells.append(_rect(cid, 330, y, 220, 60, txt,
                           style='rounded=1;whiteSpace=wrap;html=1;'
                                 'fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=11;'))

    # Diamond L1
    cells.append(_diamond('d_l1', 360, 310, 160, 70, 'L1: обфускация?'))

    # Block on L1
    cells.append(_rect('a_l1_block', 100, 320, 200, 50,
                       'verdict=block\nкатегория: obfuscation',
                       style='rounded=0;whiteSpace=wrap;html=1;'
                             'fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;'))

    # L2
    cells.append(_rect('a_l2', 330, 410, 220, 60,
                       'Слой 2: Сигнатуры\nregex, Aho-Corasick, Presidio',
                       style='rounded=1;whiteSpace=wrap;html=1;'
                             'fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=11;'))
    cells.append(_diamond('d_l2', 360, 500, 160, 70, 'L2: совпадение?'))
    cells.append(_rect('a_l2_block', 100, 510, 200, 50,
                       'verdict=block\nкатегория: prompt_injection',
                       style='rounded=0;whiteSpace=wrap;html=1;'
                             'fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;'))

    # L3
    cells.append(_rect('a_l3', 330, 600, 220, 60,
                       'Слой 3: Вектор Qdrant\ncos sim, порог 0.92',
                       style='rounded=1;whiteSpace=wrap;html=1;'
                             'fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=11;'))
    cells.append(_diamond('d_l3', 360, 690, 160, 70, 'L3: cos >= 0.92?'))
    cells.append(_rect('a_l3_block', 100, 700, 200, 50,
                       'verdict=block\nкатегория из payload',
                       style='rounded=0;whiteSpace=wrap;html=1;'
                             'fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;'))

    # L4
    cells.append(_rect('a_l4', 330, 790, 220, 60,
                       'Слой 4: DeBERTa ONNX\nscore классификатора',
                       style='rounded=1;whiteSpace=wrap;html=1;'
                             'fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=11;'))
    cells.append(_diamond('d_l4', 360, 880, 160, 70, 'L4 score?'))
    cells.append(_rect('a_l4_block', 100, 880, 200, 50,
                       'score >= 0.85\nverdict=block',
                       style='rounded=0;whiteSpace=wrap;html=1;'
                             'fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;'))

    # L5
    cells.append(_rect('a_l5', 330, 990, 220, 60,
                       'Слой 5: Сессия Redis\nCrescendo, post-refusal',
                       style='rounded=1;whiteSpace=wrap;html=1;'
                             'fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=11;'))
    cells.append(_diamond('d_l5', 360, 1080, 160, 70, 'risk > 0.6?'))
    cells.append(_rect('a_l5_block', 100, 1090, 200, 50,
                       'verdict=block\nкатегория: crescendo',
                       style='rounded=0;whiteSpace=wrap;html=1;'
                             'fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;'))

    # L7 (escalate)
    cells.append(_rect('a_l7', 750, 870, 230, 60,
                       'Слой 7: Модель-судья\ngpt-4o-mini / Claude',
                       style='rounded=1;whiteSpace=wrap;html=1;'
                             'fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=11;'))
    cells.append(_diamond('d_l7', 770, 960, 200, 70, 'judge: INJECTION?'))
    cells.append(_rect('a_l7_block', 1020, 970, 200, 50,
                       'verdict=block (L7)',
                       style='rounded=0;whiteSpace=wrap;html=1;'
                             'fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;'))

    # Provider call + L6 stream
    cells.append(_rect('a_prov', 330, 1180, 220, 60,
                       'Вызов провайдера\n(httpx.AsyncClient)',
                       style='rounded=1;whiteSpace=wrap;html=1;'
                             'fillColor=#d5e8d4;strokeColor=#82b366;fontSize=11;'))
    cells.append(_rect('a_l6', 330, 1270, 220, 60,
                       'Слой 6: Анализ SSE-потока\ncanary, PII, exfil',
                       style='rounded=1;whiteSpace=wrap;html=1;'
                             'fillColor=#d5e8d4;strokeColor=#82b366;fontSize=11;'))

    # Audit + end
    cells.append(_rect('a_audit', 330, 1360, 220, 60,
                       'Запись в request_logs\n+ detection_events',
                       style='rounded=0;whiteSpace=wrap;html=1;'
                             'fillColor=#fff2cc;strokeColor=#d6b656;fontSize=11;'))
    cells.append(_end('a_end', 420, 1460))

    # Стрелки основной ветви
    seq = ['a_start', 'a_recv', 'a_l1', 'd_l1', 'a_l2', 'd_l2',
           'a_l3', 'd_l3', 'a_l4', 'd_l4', 'a_l5', 'd_l5',
           'a_prov', 'a_l6', 'a_audit', 'a_end']
    for i in range(len(seq) - 1):
        lbl = ''
        if seq[i].startswith('d_'):
            lbl = 'нет'
        cells.append(_edge(f'ae_{i}', seq[i], seq[i+1], lbl))

    # Стрелки на блоки (да)
    for d, b in [('d_l1','a_l1_block'), ('d_l2','a_l2_block'),
                 ('d_l3','a_l3_block'), ('d_l5','a_l5_block')]:
        cells.append(_edge(f'ay_{d}', d, b, 'да'))
        cells.append(_edge(f'ab_{b}', b, 'a_audit', '', dashed=True))

    # L4 ветвление
    cells.append(_edge('ay_d_l4', 'd_l4', 'a_l4_block', 'block'))
    cells.append(_edge('ae_d_l4', 'd_l4', 'a_l7', 'escalate'))
    cells.append(_edge('ab_l4b', 'a_l4_block', 'a_audit', '', dashed=True))
    cells.append(_edge('aj_l7y', 'd_l7', 'a_l7_block', 'да'))
    cells.append(_edge('aj_l7n', 'd_l7', 'a_l5', 'нет (SAFE)'))
    cells.append(_edge('ab_l7b', 'a_l7_block', 'a_audit', '', dashed=True))

    return _wrap('\n        '.join(cells),
                 'Диаграмма активности обработки запроса',
                 page_w=1300, page_h=1600)


# ─────────────────────────────────────────────────────────────────────────────
# 7. Sequence-диаграмма (блокировка на слое 4)
# ─────────────────────────────────────────────────────────────────────────────

def diagram_sequence_block_l4():
    cells = []
    # Lifelines
    lifelines = [
        ('s_cli', 100,  'Клиентское\nприложение'),
        ('s_gw',  340,  'Шлюз\n(FastAPI)'),
        ('s_l1',  580,  'Слой 1\nNormalizer'),
        ('s_l2',  820,  'Слой 2\nSignatures'),
        ('s_l3',  1060, 'Слой 3\nVectors'),
        ('s_l4',  1300, 'Слой 4\nDeBERTa'),
        ('s_db',  1540, 'PostgreSQL\n+ Redis'),
    ]
    LIFELINE_TOP_Y = 60
    LIFELINE_HEAD_H = 40
    LIFELINE_BOTTOM_Y = 1100
    for cid, x, label in lifelines:
        # Заголовок
        cells.append(_rect(cid + '_h', x, LIFELINE_TOP_Y, 160, LIFELINE_HEAD_H,
                           label,
                           style='rounded=0;whiteSpace=wrap;html=1;'
                                 'fillColor=#dae8fc;strokeColor=#6c8ebf;'
                                 'fontSize=12;fontStyle=1;'))
        # Линия жизни
        cells.append(_edge_xy(cid + '_l',
                              x + 80, LIFELINE_TOP_Y + LIFELINE_HEAD_H,
                              x + 80, LIFELINE_BOTTOM_Y,
                              '', dashed=True))

    def y_of(line):
        return 140 + line * 80

    # Сообщения (упорядоченные сверху вниз)
    msgs = [
        # (y, x_from, x_to, label)
        (y_of(0),  180, 420, 'POST /v1/chat/completions'),
        (y_of(1),  420, 420, 'auth + rate limit'),  # self-loop
        (y_of(2),  420, 660, 'normalize(text)'),
        (y_of(3),  660, 420, 'analysis_text'),
        (y_of(4),  420, 900, 'check(text)'),
        (y_of(5),  900, 420, 'verdict=pass'),
        (y_of(6),  420, 1140, 'check(embedding)'),
        (y_of(7),  1140, 1620, 'query_points (Qdrant)'),
        (y_of(8),  1620, 1140, 'no_match'),
        (y_of(9),  1140, 420, 'verdict=pass'),
        (y_of(10), 420, 1380, 'classify(text)'),
        (y_of(11), 1380, 1380, 'ONNX inference (~50 мс)'),
        (y_of(12), 1380, 420, 'score=0.92 → verdict=block'),
        (y_of(13), 420, 1620, 'INSERT request_logs + detection_events'),
        (y_of(14), 420, 180, 'HTTP 403 — blocked'),
    ]
    msg_id = 0
    for y, x_from, x_to, label in msgs:
        msg_id += 1
        cells.append(_edge_xy(f'm{msg_id}', x_from, y, x_to, y, label))

    # Аннотация-блок (note)
    cells.append(_rect('note_l4', 1180, y_of(11) - 20, 300, 50,
                       'L4: score=0.92 >= threshold_block=0.85\n→ pipeline.run_layer возвращает block',
                       style='shape=note;whiteSpace=wrap;html=1;fillColor=#fff2cc;'
                             'strokeColor=#d6b656;fontSize=10;align=left;'))

    return _wrap('\n        '.join(cells),
                 'Sequence: блокировка на слое 4',
                 page_w=1800, page_h=1200)


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────

DIAGRAMS = [
    ('01_use_case.drawio',          diagram_use_case),
    ('02_er_conceptual.drawio',     diagram_conceptual_db),
    ('03_er_logical.drawio',        diagram_logical_db),
    ('04_er_physical.drawio',       diagram_physical_db),
    ('05_navigation_map.drawio',    diagram_navigation),
    ('06_activity_request.drawio',  diagram_activity),
    ('07_sequence_block_l4.drawio', diagram_sequence_block_l4),
]


def main():
    for filename, fn in DIAGRAMS:
        xml = fn()
        path = OUT / filename
        path.write_text(xml, encoding='utf-8')
        print(f'  {filename}  ({len(xml)} bytes)')
    print(f'\nГотово: {len(DIAGRAMS)} файлов в каталоге {OUT}/')


if __name__ == '__main__':
    main()
