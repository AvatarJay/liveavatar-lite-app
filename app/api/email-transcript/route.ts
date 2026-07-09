import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.chasingtheflames.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function transcriptToHtml(transcript: string) {
  return escapeHtml(transcript)
    .split("\n")
    .map((line) => {
      if (line.startsWith("CHEF-IT SESSION TRANSCRIPT")) {
        return `<h2 style="margin:0 0 18px;font-size:24px;color:#ffffff;">${line}</h2>`;
      }

      if (line.startsWith("Date:")) {
        return `<p style="margin:0 0 24px;color:#a1a1aa;font-size:14px;">${line}</p>`;
      }

      if (!line.trim()) {
        return `<div style="height:10px;"></div>`;
      }

      if (line.includes("] User:")) {
        return `<div style="margin:14px 0;padding:14px 16px;background:#18181b;border-radius:14px;border-left:4px solid #ffffff;">
          <p style="margin:0;color:#ffffff;font-size:15px;line-height:1.5;">${line}</p>
        </div>`;
      }

      if (line.includes("] Chef George:")) {
        return `<div style="margin:14px 0;padding:14px 16px;background:#111827;border-radius:14px;border-left:4px solid #f97316;">
          <p style="margin:0;color:#e5e7eb;font-size:15px;line-height:1.5;">${line}</p>
        </div>`;
      }

      return `<p style="margin:10px 0;color:#d4d4d8;font-size:15px;line-height:1.5;">${line}</p>`;
    })
    .join("");
}

export async function POST(req: Request) {
  try {
    const { email, transcript } = await req.json();

    if (!email || !transcript) {
      return NextResponse.json(
        { error: "Missing email or transcript" },
        { status: 400, headers: corsHeaders }
      );
    }

    const htmlTranscript = transcriptToHtml(transcript);

    const html = `
      <div style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:32px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:720px;background:#0b0b0f;border:1px solid #27272a;border-radius:22px;overflow:hidden;">
                <tr>
                  <td style="padding:30px 28px;background:#000000;text-align:center;border-bottom:1px solid #27272a;">
                    <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:-0.03em;">
                      Chef-iT
                    </h1>
                    <p style="margin:10px 0 0;color:#a1a1aa;font-size:15px;">
                      Your session transcript with Chef George
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:28px;">
                    <p style="margin:0 0 18px;color:#e5e7eb;font-size:16px;line-height:1.6;">
                      Thanks for using Chef-iT. Below is a copy of your session transcript.
                    </p>

                    <div style="margin:24px 0;padding:22px;background:#09090b;border:1px solid #27272a;border-radius:18px;">
                      ${htmlTranscript}
                    </div>

                    <p style="margin:24px 0 0;color:#a1a1aa;font-size:14px;line-height:1.6;">
                      Tip: Save this email so you can come back to Chef George's recommendations, recipes, and cooking notes anytime.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:22px 28px;background:#000000;border-top:1px solid #27272a;text-align:center;">
                    <p style="margin:0;color:#71717a;font-size:13px;line-height:1.5;">
                      Chef-iT by Chasing The Flames<br />
                      The On-Call Outdoor Chef is getting ready.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: "Chef George <chef-it@chasingtheflames.com>",
      to: email,
      subject: "Your Chef-iT Session with Chef George",
      text: transcript,
      html,
      replyTo: "chef-it@chasingtheflames.com",
    });

    if (error) {
      console.error("[Email Transcript Error]", error);
      return NextResponse.json(
        { error },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { success: true, data },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[Email Transcript Unexpected Error]", error);
    return NextResponse.json(
      { error: "Failed to send transcript" },
      { status: 500, headers: corsHeaders }
    );
  }
}