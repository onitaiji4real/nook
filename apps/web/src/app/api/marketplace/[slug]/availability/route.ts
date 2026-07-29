import { availabilityQuerySchema, merchantSlugSchema } from '@nook/contracts';

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly slug: string }> },
) {
  const { slug } = await context.params;
  const parsedSlug = merchantSlugSchema.safeParse(slug);
  const url = new URL(request.url);
  const parsedQuery = availabilityQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsedSlug.success || !parsedQuery.success) {
    return Response.json({ code: 'INVALID_AVAILABILITY_QUERY' }, { status: 400 });
  }

  const baseUrl = process.env.API_INTERNAL_BASE_URL ?? 'http://localhost:8080';
  const upstreamQuery = new URLSearchParams({
    serviceId: parsedQuery.data.serviceId,
    date: parsedQuery.data.date,
    days: String(parsedQuery.data.days),
  });
  if (parsedQuery.data.staffId !== undefined) {
    upstreamQuery.set('staffId', parsedQuery.data.staffId);
  }

  try {
    const response = await fetch(
      `${baseUrl}/v1/marketplace/merchants/${parsedSlug.data}/availability?${upstreamQuery.toString()}`,
      { cache: 'no-store', headers: { accept: 'application/json' } },
    );
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return Response.json({ code: 'AVAILABILITY_UPSTREAM_UNAVAILABLE' }, { status: 502 });
  }
}
