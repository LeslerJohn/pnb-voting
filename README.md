# Tropical Runway

Philippine National Bank Mindanao 6 · Christmas in the Tropics

One phone ballot covers **Best Dress Female** and **Best Dress Male**. The pageant-inspired flow lets guests browse portraits, select both nominees, then review and submit once. The projector can switch between the QR invitation and a nominee slideshow. The host closes voting separately from revealing the animated results.

## Local rehearsal

Use Node.js 22 or newer.

```powershell
npm.cmd ci
npm.cmd run dev -- -H 127.0.0.1
```

- [Phone ballot](http://localhost:3001)
- [Host console](http://localhost:3001/host)
- [Projector screen](http://localhost:3001/stage)

In development without Supabase settings, the app uses embedded PostgreSQL and stores rehearsal data in `.rehearsal/`. The development host password is `pnb-rehearsal-only`. Override the password with `ADMIN_PASSWORD` in `.env.local` when needed. Keep this default-password rehearsal on loopback.

For an isolated rehearsal, set `REHEARSAL_DATA_DIR` to a new writable directory before launching. To rehearse a production build locally, set `REHEARSAL_MODE=1` and a unique `ADMIN_PASSWORD` of at least 16 characters, build, then run `npm.cmd run start`. To scan the QR from another device on the same network, open the projector screen using a LAN address reachable from that phone. A localhost QR works on the host computer. Verify the network path from a guest device.

## Live event setup

1. Create a Supabase project and apply [the database migration](supabase/migrations/20261116000000_party_ballot.sql) using the Supabase SQL editor or migration workflow. It creates the poll, nominees, attendee codes, ballots, and portrait bucket.
2. Deploy this folder to an HTTPS Next.js Node.js host in a region near the Supabase database. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a unique `ADMIN_PASSWORD` of at least 16 characters on the server. Copy the variable names from [.env.example](.env.example). Keep the service role key server-side. Set `NEXT_PUBLIC_VOTING_URL` before building if the QR needs an explicit canonical domain.
3. In `/host`, add, edit, or remove nominees before opening the poll. Upload JPEG, PNG, WebP or AVIF headshots up to 4 MB. Photos are center-cropped to portrait format and served as compressed WebP. Nominee photos and revealed results are accessible from the event link.
4. Generate attendee codes and download the CSV immediately. Give one unique code to each guest at check-in. The database stores hashes, so the plaintext batch is available only during generation.
5. Open `/stage` on the projector and test the QR on a phone. Use **Show nominees** to present the nominees, with optional autoplay. Switch back to the QR and select **Open voting** from the host console when ready.
6. Select **Close voting** after the voting window. Select **Reveal results** on cue. The event screen shows each top nominee and the vote breakdown. Ties remain visible as ties.

This deployment represents one poll. Use a separate database project for test ballots or a second event. Validate the guest network and run a 300-client rehearsal against the selected hosting, CDN and Supabase region before the party.

## Traffic and vote handling

Next.js, shadcn/ui controls on Tailwind CSS, Motion for React, Supabase PostgreSQL and Supabase Storage. Shared public reads can be cached briefly at the CDN. Phones poll with jitter and submit one small request per ballot. The projector updates turnout independently, and browsers never receive category tallies before the host reveals results. Static assets and pre-sized photos keep ballot traffic small.

The database accepts one ballot per issued attendee code. Both choices are validated and saved together. Retrying the same code and same choices returns the original receipt, while using that code with different choices returns a conflict. The phase is locked transactionally during casting so closing the poll cannot interleave with a ballot commit.

The portrait-first interaction is adapted from the official [Miss Universe voting rules](https://www.missuniverse.com/choicely-voting-rules/).
