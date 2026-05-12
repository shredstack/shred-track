import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How ShredTrack collects, uses, and protects your personal information.",
};

const EFFECTIVE_DATE = "May 12, 2026";
const SUPPORT_EMAIL = "shredstacksarah@gmail.com";

export default function PrivacyPolicyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-mesh">
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="font-oswald text-lg font-bold tracking-tight text-gradient-primary"
          >
            ShredTrack
          </Link>
          <nav className="flex items-center gap-3 text-xs">
            <Link
              href="/login"
              className="rounded-lg bg-primary/15 px-3 py-1.5 font-medium text-primary hover:bg-primary/25 transition-colors"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
          Privacy <span className="text-gradient-primary">Policy</span>
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Effective {EFFECTIVE_DATE}
        </p>

        <div className="prose prose-invert mt-8 max-w-none text-sm leading-relaxed text-foreground/90 space-y-8">
          <section className="space-y-3">
            <p>
              ShredTrack (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) is a mobile-first
              web and iOS application that helps HYROX and CrossFit athletes track workouts,
              log scores, follow training plans, and compete with their community. This
              Privacy Policy explains what information we collect, how we use it, and the
              choices you have. By creating an account or using ShredTrack, you agree to
              the practices described here.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">Information We Collect</h2>

            <h3 className="text-base font-semibold text-white pt-2">Account information</h3>
            <p>
              When you sign up we collect the information you provide: your email address,
              your name, and (if you create a password account) a password we never see in
              plaintext. If you sign in with Google or Apple, we receive your email address
              and basic profile information from that provider as authorized by you.
            </p>

            <h3 className="text-base font-semibold text-white pt-2">Profile information</h3>
            <p>
              You may optionally provide a username, gender, body weight, profile photo,
              unit preference (metric or mixed), and a primary community/gym. You can edit
              or remove this information from your account settings at any time.
            </p>

            <h3 className="text-base font-semibold text-white pt-2">Training and performance data</h3>
            <p>
              ShredTrack stores the workout and performance information you log, including:
              workouts and benchmark scores, movements, weights, reps, times, and notes;
              HYROX practice races, splits, race reports, predictions, and station
              assessments; recovery routines and sessions; and any photos, comments, or
              reactions you post within the app.
            </p>

            <h3 className="text-base font-semibold text-white pt-2">Community and social data</h3>
            <p>
              If you join a community or gym inside ShredTrack, we record your membership
              and any role you hold within it (member, coach, admin). Comments and reactions
              you post on scores are visible to other members of that community.
            </p>

            <h3 className="text-base font-semibold text-white pt-2">Purchases</h3>
            <p>
              If you purchase a training plan or other paid feature, we store a record of
              the purchase and the entitlements it grants you. Payment details are handled
              by our payment processor; we do not see or store your full card number.
            </p>

            <h3 className="text-base font-semibold text-white pt-2">Technical and usage information</h3>
            <p>
              We log standard technical information needed to operate the service, such as
              authentication session tokens, IP address (used by our infrastructure providers
              to deliver responses and prevent abuse), browser/device type, and timestamps of
              key actions like sign-in, workout saves, and race-report submissions. We also
              store small preferences (such as your unit toggle and active gym) in your
              device&rsquo;s local storage.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>To provide the core features of the app — saving your workouts, displaying your history, generating training plans, and computing race predictions.</li>
              <li>To authenticate you and keep your account secure.</li>
              <li>To deliver transactional emails (account activation, password reset, community invitations).</li>
              <li>To generate AI-assisted insights and summaries from the workout notes and scores you submit, when you use those features.</li>
              <li>To enable community features when you opt in to join a gym or community.</li>
              <li>To respond to support requests and improve the product.</li>
            </ul>
            <p>
              We do <strong>not</strong> sell your personal information, and we do not use
              your training data to target you with advertising.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">Service Providers We Use</h2>
            <p>
              ShredTrack relies on the following third-party services to operate. Each is
              bound by its own privacy practices and processes data only as needed to provide
              the service to us:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Supabase</strong> &mdash; authentication and PostgreSQL database hosting.</li>
              <li><strong>Vercel</strong> &mdash; web application hosting and request routing.</li>
              <li><strong>Resend</strong> &mdash; transactional email delivery (account confirmation, password reset, invitations).</li>
              <li><strong>Anthropic</strong> &mdash; AI-generated insights and notes extraction. Only the workout notes and score data necessary to produce the requested insight are sent; we do not send your account credentials.</li>
              <li><strong>Google</strong> &mdash; optional Sign in with Google.</li>
              <li><strong>Apple</strong> &mdash; optional Sign in with Apple.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">How We Share Information</h2>
            <p>
              We share your information only in these limited situations:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>With other members of communities you join.</strong> If you join a gym or community, the workouts, scores, comments, and reactions you post are visible to other members of that community. You can leave a community at any time.</li>
              <li><strong>With our service providers</strong> listed above, only to the extent necessary to run the app.</li>
              <li><strong>If required by law,</strong> such as in response to a valid subpoena, court order, or other legal process.</li>
              <li><strong>To protect rights and safety,</strong> for example to investigate fraud or violations of our terms.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">Your Choices and Rights</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Access and update.</strong> You can view and edit your profile data inside the app.</li>
              <li><strong>Delete your account.</strong> You can request account deletion at any time by emailing us at {SUPPORT_EMAIL}. We will delete your account and associated personal data within 30 days, except where we are required to retain limited information for legal, accounting, or security reasons.</li>
              <li><strong>Export.</strong> You can request a copy of the personal data we hold about you by emailing {SUPPORT_EMAIL}.</li>
              <li><strong>Opt out of non-essential email.</strong> You can unsubscribe from optional emails using the link in any email we send. We will still send transactional messages (e.g. password reset) when needed to operate your account.</li>
            </ul>
            <p>
              If you are located in the European Economic Area, the United Kingdom, or
              California, you may have additional rights under applicable law (such as the
              right to object to processing or to lodge a complaint with a regulator).
              Contact us at {SUPPORT_EMAIL} to exercise any of these rights.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">Data Retention</h2>
            <p>
              We retain your account information and training data for as long as your
              account is active. When you delete your account, we delete or anonymize your
              personal information within 30 days, except for limited records we are
              required to keep (for example, transaction records for tax purposes, or
              security logs for abuse investigation).
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">Security</h2>
            <p>
              We use industry-standard safeguards to protect your information, including
              encrypted connections (TLS) between your device and our servers, hashed
              password storage, and access controls on our database. No method of
              transmission or storage is 100% secure, but we work to protect your
              information and will notify you of any breach that materially affects your
              account, as required by law.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">Children&rsquo;s Privacy</h2>
            <p>
              ShredTrack is not directed to children under 13, and we do not knowingly
              collect personal information from children under 13. If you are a parent or
              guardian and believe your child has provided us information, please contact
              us at {SUPPORT_EMAIL} and we will delete it.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">International Users</h2>
            <p>
              ShredTrack is operated from the United States. If you access the service from
              outside the United States, your information will be transferred to, stored,
              and processed in the United States and other countries where our service
              providers operate.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. When we make material
              changes, we will update the &ldquo;Effective&rdquo; date at the top of this page and,
              where appropriate, notify you in the app or by email. Your continued use of
              ShredTrack after an update means you accept the revised policy.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">Contact Us</h2>
            <p>
              If you have questions or requests about this Privacy Policy or your data,
              contact us at <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>.
            </p>
          </section>
        </div>

        <div className="mt-12 border-t border-white/[0.06] pt-6 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-primary transition-colors">
            &larr; Back to ShredTrack
          </Link>
        </div>
      </main>
    </div>
  );
}
