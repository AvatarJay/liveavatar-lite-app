import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    const { email, transcript } = await req.json();

    if (!email || !transcript) {
      return NextResponse.json(
        { error: "Missing email or transcript" },
        { status: 400 }
      );
    }

    const { data, error } = await resend.emails.send({
      from: "Chef-it <onboarding@resend.dev>",
      to: email,
      subject: "Your Chef-it Session Transcript",
      text: transcript,
    });

    if (error) {
      console.error("[Email Transcript Error]", error);
      return NextResponse.json({ error }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[Email Transcript Unexpected Error]", error);
    return NextResponse.json(
      { error: "Failed to send transcript" },
      { status: 500 }
    );
  }
}