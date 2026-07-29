import type { PublicMerchantResponse } from '@nook/contracts';
import React from 'react';

import { AvailabilityPicker } from './availability-picker';
import { ConsumerSessionProvider } from './consumer-session-provider';

const categoryLabels = {
  NAIL: 'NAIL ART',
  LASH: 'LASH',
  BROW: 'BROW',
  BEAUTY: 'BEAUTY',
  HAIR: 'HAIR',
  OTHER: 'STUDIO',
} as const;

export function MerchantPublicPage({
  bookingIntent,
  merchant,
  preview = false,
}: {
  readonly bookingIntent?:
    | {
        readonly serviceId: string;
        readonly locationId: string;
        readonly rescheduleAppointmentId: string;
      }
    | undefined;
  readonly merchant: PublicMerchantResponse;
  readonly preview?: boolean;
}) {
  const locationText = `${merchant.location.city} ${merchant.location.district}`;
  return (
    <ConsumerSessionProvider preview={preview}>
      <main className="merchant-page">
        <header className="merchant-nav">
          <a className="merchant-monogram" href="#top" aria-label={`${merchant.name} 首頁`}>
            {merchant.name.slice(0, 1)}
            <i />
          </a>
          <div className="merchant-nav-meta">
            <span>{categoryLabels[merchant.category]}</span>
            <span>TAIPEI · APPOINTMENT ONLY</span>
          </div>
          {preview ? (
            <span className="preview-ribbon">LOCAL PREVIEW</span>
          ) : (
            <a href="#services">查看服務</a>
          )}
        </header>

        <section className="merchant-hero" id="top">
          <div className="merchant-hero-copy">
            <p className="merchant-kicker">{locationText} · 私人預約制</p>
            <h1>{merchant.name}</h1>
            <p className="merchant-description">{merchant.description}</p>
            <div className="merchant-hero-actions">
              <a className="merchant-primary-action" href="#services">
                探索服務 <span>↓</span>
              </a>
              {merchant.contact.instagramUrl === null ? null : (
                <a
                  className="merchant-text-link"
                  href={merchant.contact.instagramUrl}
                  rel="noreferrer"
                >
                  Instagram ↗
                </a>
              )}
            </div>
          </div>
          <div className="merchant-hero-art" aria-label="店家作品精選">
            <div
              className="merchant-art-frame merchant-art-main"
              style={imageStyle(merchant.portfolio[0]?.imageUrl)}
            >
              <span>01</span>
            </div>
            <div
              className="merchant-art-frame merchant-art-small"
              style={imageStyle(merchant.portfolio[1]?.imageUrl)}
            >
              <span>02</span>
            </div>
            <p>
              THE QUIET DETAIL
              <br />
              MAKES THE WHOLE.
            </p>
          </div>
        </section>

        <section className="merchant-services" id="services">
          <div className="merchant-section-intro">
            <p>01 / MENU</p>
            <h2>
              把時間留給
              <br />
              <em>真正重要的細節。</em>
            </h2>
          </div>
          <div className="merchant-service-list">
            {merchant.services.map((service, index) => (
              <article key={service.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{service.name}</h3>
                  <p>{service.description}</p>
                </div>
                <div className="merchant-service-facts">
                  <strong>{formatPrice(service)}</strong>
                  <small>{service.durationMinutes} MIN</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <AvailabilityPicker bookingIntent={bookingIntent} merchant={merchant} preview={preview} />

        <section className="merchant-work">
          <div className="merchant-work-heading">
            <p>02 / SELECTED WORK</p>
            <h2>近期作品</h2>
          </div>
          <div className="merchant-work-grid">
            {merchant.portfolio.map((item, index) => (
              <article
                key={item.id}
                className={`merchant-work-item merchant-work-item-${(index % 3) + 1}`}
              >
                <div className="merchant-work-image" style={imageStyle(item.imageUrl)}>
                  <span>0{index + 1}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.tags.join(' · ')}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="merchant-visit">
          <div>
            <p>03 / VISIT</p>
            <h2>
              抵達以前，
              <br />
              先保留一段安靜。
            </h2>
          </div>
          <dl>
            <div>
              <dt>地點</dt>
              <dd>{locationText}</dd>
            </div>
            <div>
              <dt>地址說明</dt>
              <dd>
                {merchant.location.disclosure === 'FULL'
                  ? merchant.location.address
                  : '完整地址將於預約成立後提供'}
              </dd>
            </div>
            <div>
              <dt>預約須知</dt>
              <dd>{merchant.policies.booking}</dd>
            </div>
            <div>
              <dt>取消政策</dt>
              <dd>{merchant.policies.cancellation}</dd>
            </div>
          </dl>
        </section>

        <footer className="merchant-footer">
          <span>{merchant.name}</span>
          <small>Powered by Nook · Asia/Taipei</small>
        </footer>
      </main>
    </ConsumerSessionProvider>
  );
}

function formatPrice(service: PublicMerchantResponse['services'][number]): string {
  if (service.priceType === 'QUOTE') return '私訊報價';
  if (service.priceType === 'RANGE')
    return `NT$ ${service.priceMin?.toLocaleString()}–${service.priceMax?.toLocaleString()}`;
  const amount = service.priceAmount?.toLocaleString() ?? '—';
  return service.priceType === 'FROM' ? `NT$ ${amount} 起` : `NT$ ${amount}`;
}

function imageStyle(url: string | undefined): { readonly backgroundImage: string } | undefined {
  return url === undefined || url.length === 0
    ? undefined
    : { backgroundImage: `url(${JSON.stringify(url).slice(1, -1)})` };
}
