# TransifyAvatar

一个基于 Nuxt.js + NaiveUI + Transformers.js 的蓝粉白背景头像生成器，灵感来源于程序员社群文化梗。

## 项目背景

在程序员社群中流传着一个有趣的文化梗：技术力决定了头像风格。其中使用蓝粉白背景（跨性别旗帜颜色）作为头像被认为是技术实力的最高象征，意味着水平高到足以支持自己完全不顾外界评价。

TransifyAvatar 是一个基于这个文化梗创建的娱乐性工具，允许用户上传头像并自动添加蓝粉白背景，体验“程序员最高境界”。

## 功能特点

- ✨ 使用 AI 技术自动抠图
- 🏳️⚧️ 添加跨性别旗帜背景（蓝粉白渐变）
- ⚙️ 抠图支持 RMBG-1.4 / IMGLY 模型或基于纯色背景的抠图方式
- 🚀 纯前端实现，无需后端服务

## 技术栈

- **前端框架**: Vue 3 + Nuxt.js 3
- **UI 组件库**: Naive UI
- **AI 模型**: Transformers.js (用于图像分割)
- **图像处理**: Canvas API
- **构建工具**: Vite

## 相关项目

- https://github.com/xenova/transformers.js - 在浏览器中运行 🤗 Transformers 的 JavaScript 库
- https://nuxt.com/ - 直观的 Vue 框架
- https://www.naiveui.com/ - 一个 Vue 3 组件库
- https://github.com/imgly/background-removal-js - 在浏览器中抠图的 JavaScript 库
- https://huggingface.co/briaai/RMBG-1.4 - 一个用于抠图的 AI 模型

---

本项目仅为娱乐目的，不涉及任何政治立场。