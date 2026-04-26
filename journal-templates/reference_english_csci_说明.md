# reference_english_csci 说明

更新时间：2026-04-19

对应模板文件：

- `D:\GitHub\md-docx-mermaid-exporter\journal-templates\reference_english_csci.docx`

## 官方来源

本模板来自 CSCI 官方投稿页面提供的 Paper template：

- CSCI Submission: https://csci.org/sub.html
- 官方模板直链: https://www.ijmlc.org/IJMLC_template.doc

CSCI 官方投稿页面在 Full Paper Submission 区域要求作者使用 Paper template，并提示不要修改模板中的 margins、fonts、spacing 等版式设置。

## 处理方式

- 原始官方模板已保存为：`journal-templates\official\CSCI_IJMLC_template.doc`
- 插件内置 reference 使用 Word 将官方 `.doc` 模板转换为 `.docx`，保存为：`journal-templates\reference_english_csci.docx`
- 这样 Pandoc 可以直接通过 `--reference-doc` 使用该模板，同时最大程度保留官方模板中的页边距、字体和标题样式。

## 插件使用方式

`mdocxConverter.referenceLanguage` 默认为 `english`，因此在没有配置 `mdocxConverter.referenceDocx`，且 Markdown 同目录没有 `reference.docx` 时，会自动使用这份英文 CSCI reference。

如需显式指定：

```json
{
  "mdocxConverter.referenceLanguage": "english"
}
```

如需切换为中文 CSSCI 通用 reference：

```json
{
  "mdocxConverter.referenceLanguage": "chinese"
}
```
