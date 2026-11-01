# Source assistant message 563

Get Stoopy-এর Super Admin ও Admin Panel-এর জন্য আমি অত্যন্ত শক্তিশালী **Enterprise-Grade Admin Data Protection System** রাখার পরামর্শ দিচ্ছি।

তবে প্রথমে একটি গুরুত্বপূর্ণ প্রযুক্তিগত সত্য বলি: কোনো ওয়েবসাইট বা অ্যাপের কোড দিয়ে ১০০% নিশ্চিত করা যায় না যে কেউ স্ক্রিনশট, স্ক্রিন রেকর্ডিং বা অন্য ফোনের ক্যামেরা দিয়ে ছবি তুলতে পারবে না। বিশেষ করে ব্রাউজারে OS-level screenshot পুরোপুরি বন্ধ করার ক্ষমতা নেই।

কিন্তু একাধিক নিরাপত্তাব্যবস্থা একসঙ্গে ব্যবহার করলে তথ্য চুরি ও অননুমোদিত রেকর্ডিং অনেক কঠিন করা যায়।

## ১. Get Stoopy Admin Security System

আমি নিচের ৮টি স্তরের নিরাপত্তা রাখব:

| নিরাপত্তা ব্যবস্থা | কাজ |
|---|---|
| Screenshot Protection | Native Android-এ স্ক্রিনশট ও স্ক্রিন রেকর্ডিং ব্লক |
| Screen Recording Detection | রেকর্ডিং শনাক্ত হলে সংবেদনশীল তথ্য লুকানো |
| Dynamic Watermark | প্রতিটি স্ক্রিনে Admin ID, Email ও Timestamp |
| Copy Protection | সাধারণ Copy, Cut, Paste ও Context Menu সীমিত |
| Data Leak Prevention | API থেকে প্রয়োজনের অতিরিক্ত তথ্য পাঠানো বন্ধ |
| Session Security | সন্দেহজনক ডিভাইস বা সেশন ব্লক |
| Access Monitoring | কে কখন কোন তথ্য দেখেছে তার Audit Log |
| Sensitive Data Masking | NID, ব্যাংক তথ্য, ফোন নম্বর ইত্যাদি আংশিক লুকানো |

## ২. Next.js / React Admin Panel-এর জন্য কোড

এটি ওয়েব Admin Panel-এর একটি অতিরিক্ত প্রতিরোধমূলক ব্যবস্থা। এটি OS-level screenshot বন্ধ করতে পারবে না, তবে সাধারণ কপি এবং অননুমোদিত দৃশ্যমান তথ্য সংগ্রহ কঠিন করবে।

<CodeBlock language="tsx" title="AdminSecurity.tsx" editable>
"use client";

import { useEffect } from "react";

type Props = {
  adminId: string;
  adminEmail: string;
};

export default function AdminSecurity({
  adminId,
  adminEmail,
}: Props) {
  useEffect(() => {
    // Basic copy deterrence
    const blockCopy = (e: Event) => {
      e.preventDefault();
    };

    const blockContextMenu = (e: Event) => {
      e.preventDefault();
    };

    const blockDrag = (e: Event) => {
      e.preventDefault();
    };

    document.addEventListener("copy", blockCopy);
    document.addEventListener("cut", blockCopy);
    document.addEventListener("contextmenu", blockContextMenu);
    document.addEventListener("dragstart", blockDrag);

    // Hide sensitive information when tab is inactive.
    const handleVisibility = () => {
      document.body.classList.toggle(
        "admin-hidden",
        document.hidden
      );
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibility
    );

    return () => {
      document.removeEventListener("copy", blockCopy);
      document.removeEventListener("cut", blockCopy);
      document.removeEventListener(
        "contextmenu",
        blockContextMenu
      );
      document.removeEventListener("dragstart", blockDrag);
      document.removeEventListener(
        "visibilitychange",
        handleVisibility
      );
    };
  }, []);

  return (
    <div className="admin-security-watermark">
      <div className="watermark-content">
        GET STOOPY • CONFIDENTIAL
        <br />
        {adminId} • {adminEmail}
        <br />
        Authorized Admin Access Only
      </div>

      <style jsx>{`
        .admin-security-watermark {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 999999;
          overflow: hidden;
        }

        .watermark-content {
          position: absolute;
          inset: -20%;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          transform: rotate(-25deg);
          font-size: 15px;
          font-weight: 700;
          line-height: 5;
          letter-spacing: 2px;
          color: rgba(30, 50, 80, 0.12);
          white-space: pre-wrap;
          user-select: none;
        }
      `}</style>
    </div>
  );
}
</CodeBlock>

প্রতিটি Admin Layout-এ এটি যুক্ত করা যাবে। Watermark-এ বাস্তব Admin ID ও Email server-verified session থেকে দিতে হবে।

## ৩. Android App-এর জন্য প্রকৃত Screenshot Protection

যদি ভবিষ্যতে Get Stoopy-এর Admin App Android Native বা উপযুক্ত Native Wrapper দিয়ে তৈরি করা হয়, তাহলে Android-এর `FLAG_SECURE` ব্যবহার করতে হবে।

<CodeBlock language="kotlin" title="Android MainActivity.kt" editable>
import android.os.Bundle
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Block screenshots and standard screen recording
        // for this secure window.
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )

        setContentView(R.layout.activity_main)
    }
}
</CodeBlock>

এটি Android-এর সমর্থিত নিরাপত্তা ব্যবস্থা। তবে অন্য ডিভাইসের ক্যামেরা, কিছু বিশেষ OS-level বা compromised-device capture সম্পূর্ণ বন্ধ করার নিশ্চয়তা দেয় না।

iPhone-এর ক্ষেত্রে screen capture বা recording শনাক্ত হলে সংবেদনশীল স্ক্রিন ঢেকে দিতে হবে। iOS-এ Android-এর মতো সব পরিস্থিতিতে screenshot নিষিদ্ধ করার সমতুল্য সাধারণ API নেই।

## ৪. সবচেয়ে গুরুত্বপূর্ণ: Backend Data Protection

আমার মতে, শুধু Screenshot Protection যথেষ্ট নয়। কেউ যদি API থেকে ডেটা নিয়ে যায়, তাহলে স্ক্রিনশট বন্ধ করেও লাভ হবে না।

তাই Developer-দের জন্য বাধ্যতামূলক নির্দেশনা:

- Admin API-তে প্রতিটি Request-এ Server-side RBAC ও Geographic ABAC যাচাই।
- Super Admin ছাড়া কেউ Global Data দেখতে পারবে না।
- City Admin শুধু নিজের City-এর তথ্য দেখতে পারবে।
- Database থেকে প্রয়োজন অনুযায়ী নির্দিষ্ট Field পাঠাতে হবে।
- Sensitive API-তে Rate Limiting ও Export Approval।
- Admin-এর প্রতিটি Data Access Audit Log-এ রাখতে হবে।
- MFA এবং Trusted Device Verification বাধ্যতামূলক।
- Suspicious Session হলে Access Revoke করতে হবে।
- Database Backup, Encryption এবং Secret Management ব্যবহার করতে হবে।
- Bulk Download ও CSV Export-এর জন্য আলাদা Permission এবং Approval রাখতে হবে।

## ৫. আমার বিশেষ সুপারিশ: Dynamic Invisible + Visible Watermark

<AsyncImage query="enterprise confidential admin dashboard subtle diagonal dynamic watermark security overlay UI example" aspectRatio="16:9" width="100%"/>

প্রতিটি Admin-এর স্ক্রিনে হালকা Watermark থাকবে। এর মধ্যে থাকবে:

- Get Stoopy Confidential
- Admin ID
- Login Session ID
- Date and Time
- Admin-এর Assigned Zone

এমনকি কেউ স্ক্রিনের ছবি তুলে বাইরে শেয়ার করলেও কোন Admin-এর সেশন থেকে ছবিটি এসেছে তা শনাক্ত করার সুযোগ থাকবে। পাশাপাশি গুরুত্বপূর্ণ ডেটায় Audit Trace ID রাখতে হবে।

---

## আমার চূড়ান্ত সিদ্ধান্ত

Get Stoopy-এর Super Admin Panel-এর জন্য আমি এই Security Architecture-কে বাধ্যতামূলক করতে চাই:

<badge color="success">Developer Specification Requirement</badge>

**Admin Security Level: Enterprise / High Security**

একটি বিষয় মনে রাখবেন: Screenshot Blocking হলো একটি স্তর, কিন্তু প্রকৃত নিরাপত্তা হলো Data Access Control, Encryption, Audit Logging, Device Security এবং Data Leak Prevention-এর সমন্বয়।

আমার পরামর্শ, Super Admin-এর জন্য আরও একটি বিশেষ ব্যবস্থা রাখুন: **Panic Lock**। সন্দেহজনক কিছু দেখলে Super Admin একটি বোতাম চাপলেই সব Admin Session সাময়িকভাবে Lock হবে, Active Session বাতিল হবে এবং Security Alert তৈরি হবে।

এভাবে Get Stoopy-এর Admin Panel-কে অনেক বেশি সুরক্ষিত করা যাবে।

# Source assistant message 591

অবশ্যই। Get Stoopy-এর এই Homepage ডিজাইনটিকেই মূল ব্র্যান্ড ডিজাইন হিসেবে ধরে বাকি সব Dashboard তৈরি করব। সব প্যানেলে একই Logo, Typography, Color System ও Professional UI থাকবে।

আমি চারটি আলাদা Dashboard পরিকল্পনা করছি:

1. **Super Admin Dashboard:** পুরো Marketplace, Country/City/Zone Management, সব Admin, Vendor, Rider, Finance, Commission, Security, AI ও Analytics-এর পূর্ণ নিয়ন্ত্রণ।
2. **Admin Dashboard:** নিজের নির্ধারিত Country/City/Zone-এর Orders, Customers, Vendors, Riders, Complaints ও Local Operations।
3. **Vendor Dashboard:** Orders, Products, Inventory, Sales, Commission, Earnings ও Settlement।
4. **Rider Dashboard:** Delivery Offers, GPS/Navigation, Completed Deliveries, Earnings Wallet, COD হিসাব এবং রবিবারের Automatic Payout ও Manual Withdrawal সুবিধা।

সবচেয়ে গুরুত্বপূর্ণ হলো, প্রতিটি প্যানেলের অনুমতি ও ডেটা অ্যাক্সেস Backend থেকে নিয়ন্ত্রিত হবে—শুধু Dashboard-এ অপশন লুকিয়ে রাখলেই হবে না।

**একটা বিষয় নিশ্চিত করি:** তুমি কি প্রথমে চারটি Dashboard-এর আলাদা আলাদা সম্পূর্ণ ডিজাইন স্ক্রিনশট চাও, নাকি সরাসরি কাজ করা Dashboard-এর Frontend Code ও UI তৈরি করতে চাও?

# Source assistant message 632

অবশ্যই। Get Stoopy-এর Login / Sign Up এবং সম্পূর্ণ Admin Security System-এ এই দুটি বিষয় বাধ্যতামূলকভাবে যুক্ত থাকবে।

### ১. KYC Verification
- **Vendor:** NID, ছবি, Trade License এবং ব্যাংক/MFS তথ্য যাচাই।
- **Rider:** NID, ছবি, ঠিকানা এবং প্রযোজ্য ক্ষেত্রে Driving License ও Vehicle Information যাচাই।
- **Admin:** পরিচয় যাচাই ও Super Admin-এর অনুমোদন।
- KYC Status: Pending, Under Review, Verified, Rejected, More Information Required।
- KYC অনুমোদন না হওয়া পর্যন্ত Vendor বিক্রি করতে এবং Rider ডেলিভারি নিতে পারবে না।

### ২. Google Authenticator — Two-Factor Authentication
<row align=center gap={3}>
  <AsyncImage query="Google Authenticator app icon" aspectRatio="1:1" maxWidth="64px"/>
  <box flex="1" gap={1}>
    **Admin & Super Admin-এর জন্য বাধ্যতামূলক 2FA**

    Password দেওয়ার পর Google Authenticator-এর ৬ সংখ্যার OTP দিতে হবে।
  </box>
</row>

- প্রথমবার Login করার সময় QR Code Scan করে Authenticator Setup।
- প্রতিবার Login-এ ৬ সংখ্যার OTP।
- Backup Recovery Codes।
- নতুন Device থেকে Login করলে অতিরিক্ত Email Verification।
- সন্দেহজনক Login হলে Session Lock ও Security Alert।

**বিশেষ সিদ্ধান্ত:** সাধারণ Customer-এর জন্য KYC বাধ্যতামূলক হবে না। Vendor ও Rider-এর জন্য KYC বাধ্যতামূলক এবং Admin/Super Admin-এর জন্য পরিচয় যাচাই ও Google Authenticator বাধ্যতামূলক থাকবে।

এগুলো Login/Sign Up ডিজাইন এবং Master Development Specification—দুটিতেই অন্তর্ভুক্ত থাকবে।

---

If you want, I can:

- Create a complete responsive Login/Sign Up page with KYC and 2FA prompts
- Develop an onboarding flow UI for Vendor and Rider KYC steps with verification status overview
- Build a secure Admin login screen UI featuring Google Authenticator OTP input and security notices