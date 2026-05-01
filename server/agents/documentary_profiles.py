"""Shared documentary production helpers.

The current P0 needs a stable offline path, so these profiles turn sparse
FactCards into usable documentary structure instead of demo-grade placeholders.
"""

from __future__ import annotations

from typing import Any


CHAPTER_ONE_TARGET_SECONDS = 180
CHAPTER_ONE_SHOT_COUNT = 18


TOPIC_PROFILES: list[dict[str, Any]] = [
    {
        "id": "porcelain",
        "label": "景德镇制瓷",
        "keywords": ("景德镇", "瓷", "窑", "拉坯", "修坯", "釉", "青花", "陶轮", "瓷土", "高岭"),
        "theme": "一团泥在水、手与火之间获得稳定形体",
        "environment": "景德镇老作坊,旧砖墙,木架,陶轮,半开的窑门,瓷土粉尘停在晨光里",
        "person": "四十岁左右的匿名制瓷工匠,深色棉麻工作服,袖口沾泥,手指有长期劳作的纹理,神情安静专注",
        "tool": "旧陶轮、修坯刀、毛笔、木案、海绵、釉料碗",
        "material": "湿润瓷泥、半干坯体、青花钴料、釉水、窑砖灰尘",
        "process": ("揉泥", "拉坯", "修坯", "绘制青花纹样", "上釉", "入窑烧成"),
        "motif": "旋转的陶轮、泥水反光、窑火、半成品器物一排排沉默等待",
        "sound": "陶轮低频转动声、湿泥摩擦声、修坯刀轻刮声、远处窑火与脚步声",
        "palette": "灰白瓷泥、钴蓝、窑火暗橙、旧木褐、清晨冷灰",
    },
    {
        "id": "embroidery",
        "label": "苏绣",
        "keywords": ("苏绣", "刺绣", "绣", "丝线", "针脚", "绷架", "绸缎", "纹样", "劈丝"),
        "theme": "细小针脚把时间、耐心与图案固定在一块布面上",
        "environment": "窗边安静绣坊,木绷架,线轴,旧剪刀,半透明描稿纸,自然光斜落在绸缎上",
        "person": "三十多岁的匿名绣工,素色上衣,坐姿稳定,手部动作很轻,眼神专注但不夸张",
        "tool": "绣针、绷架、线轴、旧剪刀、描稿纸",
        "material": "真丝线、绸缎底料、半完成花鸟纹样、细密针脚",
        "process": ("绷布", "配线", "劈丝", "起针", "铺色", "收针"),
        "motif": "针尖穿过布面、丝线反光、线轴缓慢滚动、纹样一点点显形",
        "sound": "针线穿布的细小摩擦声、剪刀轻响、布面被手指抚平的声音、室内环境底噪",
        "palette": "米白绸缎、低饱和花色、木色、窗外冷绿、柔和日光",
    },
    {
        "id": "opera",
        "label": "川剧变脸",
        "keywords": ("川剧", "变脸", "脸谱", "戏服", "锣鼓", "戏台", "演员", "袖口", "后台"),
        "theme": "后台的准备、手法与节奏共同制造台前一瞬间的变化",
        "environment": "川剧后台,旧木桌,镜灯,脸谱,戏服,肩甲,戏台侧幕与暗处道具架",
        "person": "非特定青年表演者,练功服外罩戏服局部,可见侧脸或正脸但不冒充真实名人,表情克制专注",
        "tool": "脸谱纸样、画笔、戏服、袖口、镜灯、道具箱",
        "material": "布料刺绣、油彩、纸样、暗红幕布、磨损木桌",
        "process": ("整理戏服", "描画脸谱", "检查袖口", "候场", "转身变脸意象"),
        "motif": "镜灯反光、袖口遮挡、脸谱层叠、侧幕阴影、锣鼓节奏",
        "sound": "后台脚步声、戏服布料摩擦声、远处锣鼓点、镜灯电流底噪",
        "palette": "暗红、旧金、黑色阴影、暖黄镜灯、局部高饱和油彩",
    },
    {
        "id": "generic",
        "label": "非遗纪录片",
        "keywords": (),
        "theme": "一项手艺在日常劳动中被看见",
        "environment": "传统工坊,旧木桌,自然光,工具与材料按真实使用痕迹摆放",
        "person": "匿名手艺人,朴素工作服,神情专注,动作稳定,不摆拍",
        "tool": "常用工具、旧木案、材料容器、擦拭布",
        "material": "主要材料、半成品、粉尘、磨损表面、自然纹理",
        "process": ("准备材料", "处理工具", "开始制作", "检查细节", "整理半成品"),
        "motif": "手、工具、材料、光线与时间痕迹",
        "sound": "手工操作声、室内环境底噪、轻微脚步声",
        "palette": "低饱和自然色、木色、灰白、局部材料本色",
    },
]


def detect_profile(brief: str, fact_cards: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    haystack = f"{brief} " + " ".join(str(fc.get("content", "")) for fc in (fact_cards or [])[:80])
    best = TOPIC_PROFILES[-1]
    best_score = 0
    for profile in TOPIC_PROFILES[:-1]:
        score = sum(haystack.count(k) for k in profile["keywords"])
        if score > best_score:
            best = profile
            best_score = score
    return best


def timecode(seconds: int | float) -> str:
    total = max(0, int(round(seconds)))
    minutes, sec = divmod(total, 60)
    return f"{minutes:02d}:{sec:02d}"


def compact_fact_text(fact_cards: list[dict[str, Any]] | None, limit: int = 8) -> list[str]:
    out: list[str] = []
    for fc in (fact_cards or [])[:limit]:
        text = str(fc.get("content", "")).strip()
        if text:
            out.append(text[:160])
    return out


def pick_fact_refs(
    fact_cards: list[dict[str, Any]] | None,
    categories: tuple[str, ...] = (),
    limit: int = 2,
) -> list[str]:
    cards = [fc for fc in (fact_cards or []) if fc.get("fact_id")]
    if categories:
        preferred = [fc for fc in cards if fc.get("category") in categories]
        if preferred:
            cards = preferred
    return [str(fc["fact_id"]) for fc in cards[:limit]]


def duration_from_shots(shots: list[dict[str, Any]]) -> int:
    return int(sum(float(s.get("duration_estimate", 0) or 0) for s in shots))
