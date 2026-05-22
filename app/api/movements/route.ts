import { measure } from 'measure-fn';
import { getRecentHolderMovementEvents } from '../../../lib/database';
import { formatAddress } from '../../../lib/solana';

export async function GET(req: Request) {
    return await measure('GET /api/movements', async () => {
        const url = new URL(req.url);
        const wallet = url.searchParams.get('wallet') ?? undefined;
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 50)));
        const events = getRecentHolderMovementEvents(limit, wallet ?? undefined).map((event) => ({
            ...event,
            addressShort: formatAddress(event.address),
        }));

        return Response.json({
            success: true,
            events,
            total: events.length,
            source: 'snapshot-diff',
            timestamp: Date.now(),
        });
    }, (error) => {
        console.error('Error loading holder movement events:', error);
        return Response.json({ success: false, error: 'Unable to load holder movement events.' }, { status: 500 });
    });
}
