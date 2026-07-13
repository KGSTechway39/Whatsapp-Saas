import { redirect } from "next/navigation";

export default function RootPage() {
  // In demo mode the root URL drops straight into the app; middleware performs
  // the auto-login. Otherwise land on the login screen as usual.
  redirect(process.env.DEMO_AUTO_LOGIN === "true" ? "/dashboard" : "/login");
}
