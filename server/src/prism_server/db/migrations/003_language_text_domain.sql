-- 扩展模型和手记的研究领域；保留已有记录及旧领域。
ALTER TABLE models DROP CONSTRAINT models_domain_check;
ALTER TABLE models ADD CONSTRAINT models_domain_check
    CHECK (domain IN ('图片', 'CAD', '视频', '语言文本'));

ALTER TABLE research_notes DROP CONSTRAINT research_notes_domain_check;
ALTER TABLE research_notes ADD CONSTRAINT research_notes_domain_check
    CHECK (domain IN ('图片', 'CAD', '视频', '语言文本'));
