# reference_cssci_三刊通用 说明

更新时间：2026-04-19

对应模板文件：

- `D:\GitHub\md-docx-mermaid-exporter\journal-templates\reference_cssci_三刊通用.docx`

本模板主要综合了以下 3 本期刊模板的共性：

1. `中国文学研究_投稿模板.doc`
2. `系统管理学报_投稿模板_20260415.docx`
3. `新闻与传播评论_论文模板.pdf`

## 吸收的版式要点

### 来自《中国文学研究》

- A4 单栏版式。
- 页边距接近 `上 72 pt / 下 72 pt / 左右 90 pt`。
- 中文社科论文常见的标题区结构：
  标题
  作者
  单位
  中文关键词
  中文摘要
- 作者与摘要区更偏中文社科风格，适合文学、社科、人文类文章。

### 来自《系统管理学报》

- 正文中文使用宋体，英文和数字使用 Times New Roman。
- 正文五号附近字级更稳定，适合作为 Pandoc 默认输出基底。
- 版心更规整，适合长文和中英文混排。
- 强化了标题层级、正文、参考文献等“标准样式”对插件导出的适配性。

### 来自《新闻与传播评论》

- 前置信息区块较完整：
  摘要
  关键词
  中图分类号
  文献标识码
  文章编号
  基金项目
- 一级标题和正文的观感比较适合作为中文社科通用样式参考。

## 当前模板的实际参数

- 页面：A4
- 页边距：`上 72 pt / 下 72 pt / 左 90 pt / 右 90 pt`
- 正文：中文宋体、英文/数字 Times New Roman、`10.5 pt`、首行缩进 `21 pt`、约 `1.25` 倍行距
- 标题：黑体 `16 pt` 居中
- 作者：楷体 `10.5 pt` 居中
- 单位：宋体 `9 pt` 居中
- 一级标题：黑体 `12 pt`
- 二级标题：黑体 `10.5 pt`
- 参考文献：悬挂缩进风格

## 为 Pandoc 保留的关键样式

- `Normal`
- `Title`
- `Heading 1`
- `Heading 2`
- `Heading 3`
- `Body Text`
- `Bibliography`
- `Caption`
- `Quote`

另外保留了几组便于手工微调的扩展样式：

- `AbstractBlock`
- `KeywordsBlock`
- `MetaBlock`
- `AuthorIntroBlock`
- `ReferencesBlock`

## 使用建议

如果你想直接给插件使用，可以把 VS Code 配置里的 `paperifyMd.referenceLanguage` 切换为 `chinese`：

```json
{
  "paperifyMd.referenceLanguage": "chinese"
}
```

如果你想强制指定这份模板，则把 `paperifyMd.referenceDocx` 指向这份文件：

- `D:\\GitHub\\md-docx-mermaid-exporter\\journal-templates\\reference_cssci_三刊通用.docx`

如果后续要继续细分，可以在这份模板基础上再派生：

- `reference_cssci_文学社科.docx`
- `reference_cssci_管理经济.docx`
- `reference_cssci_新闻传播.docx`

这样会比为所有 CSSCI 期刊共用一份模板更稳。
