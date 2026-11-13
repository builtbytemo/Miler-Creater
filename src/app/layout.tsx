import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Zahi — Content & Task Command Center",
  description: "Zahi is a unified operations workspace for social content planning and personal task management.",
};

const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem("theme");var p=(s==="light"||s==="dark"||s==="system")?s:"system";var r=p==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;document.documentElement.setAttribute("data-theme",r);document.documentElement.setAttribute("data-theme-preference",p);document.documentElement.style.colorScheme=r;}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      data-theme-preference="system"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        {children}
      </body>
    </html>
  );
}
