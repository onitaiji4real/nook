import React from 'react';

import { plans, productCapabilities, productSteps, questions } from './marketing-content';

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function BookingPreview() {
  return (
    <div className="booking-preview" aria-label="Nook 店務後台預約畫面示意">
      <div className="preview-window-bar">
        <div className="preview-brand">
          <BrandMark />
          <span>nook desk</span>
        </div>
        <span className="preview-date">7月 21日 · 週二</span>
      </div>

      <div className="preview-layout">
        <aside className="preview-sidebar" aria-hidden="true">
          <span className="preview-avatar">N</span>
          <span className="preview-side-line active" />
          <span className="preview-side-line" />
          <span className="preview-side-line short" />
        </aside>

        <div className="preview-content">
          <div className="preview-heading">
            <div>
              <span className="preview-kicker">TODAY</span>
              <strong>今天，3 筆預約</strong>
            </div>
            <span className="preview-status">全部已確認</span>
          </div>

          <div className="appointment-list">
            <article className="appointment-card first">
              <time>10:30</time>
              <div>
                <strong>小予 · 單色凝膠</strong>
                <span>90 分鐘 · 已確認</span>
              </div>
              <span className="appointment-mark">01</span>
            </article>
            <article className="appointment-card second">
              <time>13:00</time>
              <div>
                <strong>安琪 · 日式美睫</strong>
                <span>120 分鐘 · 新客</span>
              </div>
              <span className="appointment-mark">02</span>
            </article>
            <article className="appointment-card third">
              <time>16:00</time>
              <div>
                <strong>玟庭 · 卸甲重作</strong>
                <span>120 分鐘 · 已確認</span>
              </div>
              <span className="appointment-mark">03</span>
            </article>
          </div>
        </div>
      </div>

      <div className="line-message" aria-hidden="true">
        <span className="line-dot" />
        <div>
          <strong>預約已確認</strong>
          <span>7/21 13:00 · 日式美睫</span>
        </div>
      </div>
    </div>
  );
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

export function MarketingPage() {
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        跳至主要內容
      </a>

      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Nook 首頁">
          <BrandMark />
          <span>nook</span>
        </a>

        <nav className="site-nav" aria-label="主要導覽">
          <a href="#flow">怎麼運作</a>
          <a href="#capabilities">產品藍圖</a>
          <a href="#pricing">方案</a>
        </nav>

        <a className="header-status" href="/studio/onboarding">
          <span /> 開啟商家建檔預覽
        </a>
      </header>

      <main id="main-content">
        <section className="hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow">
              <span>LINE-FIRST</span> 美業店務系統
            </p>
            <h1>
              把空檔，
              <em>變成準時赴約。</em>
            </h1>
            <p className="hero-lead">
              Nook 把服務、班表、作品與顧客預約放進同一個入口。店家少回一點訊息，顧客不用再下載一個
              App。
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#flow">
                看看怎麼運作 <Arrow />
              </a>
              <a className="button button-text" href="#pricing">
                先看方案與費用
              </a>
            </div>
            <p className="hero-honesty">目前為產品開發階段，尚未開放註冊或收費。</p>
          </div>

          <div className="hero-visual">
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <BookingPreview />
            <p className="preview-caption">
              <span>介面示意</span>
              行動裝置也能管理一天的節奏
            </p>
          </div>
        </section>

        <section className="truth-strip" aria-label="Nook 商業原則">
          <p>店家自帶顧客</p>
          <strong>不抽成</strong>
          <span aria-hidden="true">✦</span>
          <p>平台首次媒合</p>
          <strong>8%，上限 NT$250</strong>
          <span aria-hidden="true">✦</span>
          <p>顧客端</p>
          <strong>不用下載 App</strong>
        </section>

        <section className="flow-section section" id="flow">
          <div className="section-heading">
            <p className="section-number">01 / FLOW</p>
            <div>
              <h2>
                從一句「還有空嗎？」
                <br />
                變成四個安靜的步驟。
              </h2>
              <p>先把店家每天真的會用的流程做好，再談媒合流量。</p>
            </div>
          </div>

          <ol className="step-grid">
            {productSteps.map((step) => (
              <li key={step.number}>
                <span className="step-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="manifesto-section">
          <div className="manifesto-word" aria-hidden="true">
            NO
            <br />
            APP
          </div>
          <div className="manifesto-copy">
            <p className="section-number light">02 / PRINCIPLE</p>
            <blockquote>
              「科技不該讓工作室多一個後台，
              <br />
              而是少十次來回確認。」
            </blockquote>
            <p>
              Nook 專為台灣的一人美甲、美睫與小型工作室設計。顧客從 LINE
              開始，店家保有自己的品牌與顧客關係。
            </p>
          </div>
        </section>

        <section className="capabilities-section section" id="capabilities">
          <div className="section-heading compact">
            <p className="section-number">03 / PRODUCT MAP</p>
            <div>
              <h2>一套系統，顧好預約前後。</h2>
              <p>以下是 MVP 產品藍圖；功能會依垂直任務逐步開放，不把 roadmap 當成已上線功能。</p>
            </div>
          </div>

          <div className="capability-list">
            {productCapabilities.map((capability) => (
              <article key={capability.index}>
                <span className="capability-index">{capability.index}</span>
                <h3>{capability.title}</h3>
                <p>{capability.description}</p>
                <small>{capability.note}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="pricing-section section" id="pricing">
          <div className="pricing-intro">
            <p className="section-number light">04 / PRICING DIRECTION</p>
            <h2>
              先把價值與成本
              <br />
              說清楚。
            </h2>
            <p>免費版用來開始曝光；付費版買的是省下的行政時間、完整顧客紀錄與可持續經營的工具。</p>
            <div className="pricing-notice">
              <strong>價格狀態</strong>
              <span>產品規劃價，將於封閉 Beta 前確認條款</span>
            </div>
          </div>

          <div className="pricing-grid">
            {plans.map((plan) => (
              <article
                className={plan.featured ? 'plan-card featured' : 'plan-card'}
                key={plan.name}
              >
                {plan.featured ? <span className="plan-label">一人工作室首選</span> : null}
                <div className="plan-topline">
                  <h3>{plan.name}</h3>
                  <span>{plan.audience}</span>
                </div>
                <p className="plan-price">
                  <span>NT$</span>
                  <strong>{plan.monthlyPrice}</strong>
                  <small>／月</small>
                </p>
                <p className="annual-note">{plan.annualNote}</p>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="commission-note">
            <span className="commission-big">0%</span>
            <div>
              <h3>自己的顧客，永遠是自己的。</h3>
              <p>
                從店家專屬連結、QR Code、Instagram、Google 或 LINE
                官方帳號進來的預約不抽成。只有平台首次媒合並完成服務的新客，才規劃收取 8%，單筆上限
                NT$250。
              </p>
            </div>
          </div>
        </section>

        <section className="founding-section section" id="founding">
          <div className="founding-stamp" aria-hidden="true">
            <span>100</span>
            <small>
              FOUNDING
              <br />
              STUDIOS
            </small>
          </div>
          <div className="founding-copy">
            <p className="section-number">05 / FOUNDING STUDIOS</p>
            <h2>第一批，不只是早鳥。</h2>
            <p>
              我們預計邀請 100 家願意公開價格、整理作品並持續回饋的創始店家。規劃方案為個人版 12
              個月 NT$2,388，不提供永久低價。
            </p>
            <div className="founding-status" role="status">
              <span className="status-light" />
              <div>
                <strong>申請尚未開放</strong>
                <p>我們不會在隱私政策與申請流程完成前收集聯絡資料。</p>
              </div>
            </div>
          </div>
        </section>

        <section className="faq-section section" id="faq">
          <div className="section-heading compact">
            <p className="section-number">06 / HONEST ANSWERS</p>
            <div>
              <h2>先回答難問的。</h2>
            </div>
          </div>
          <div className="faq-list">
            {questions.map((item, index) => (
              <details key={item.question} open={index === 0}>
                <summary>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {item.question}
                  <i aria-hidden="true">＋</i>
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-wordmark">
          <BrandMark />
          <strong>nook</strong>
        </div>
        <p>給認真經營每一個小角落的人。</p>
        <div className="footer-meta">
          <span>LINE-first beauty studio platform</span>
          <span>TAIWAN · ASIA/TAIPEI</span>
          <span>© 2026 NOOK</span>
        </div>
      </footer>
    </div>
  );
}
