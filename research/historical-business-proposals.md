# Source assistant message 226

আচ্ছ, আপনার মার্কেটপ্লেসের জন্য Admin Panel এমনভাবে তৈরি করা উচিত, যেন আপনি এক জায়গা থেকে পুরো বাংলাদেশের মার্কেটপ্লেস নিয়ন্ত্রণ করতে পারেন। এটা হবে এন্টারপ্রাইজ লেভেল সেন্ট্রাল অ্যাডমিন কন্ট্রোল প্যানেল। ড্যাশবোর্ডে টোটাল সেলস, টোটাল অর্ডার, পেন্ডিং অর্ডার, অ্যাকটিভ ভেন্ডর, টোটাল কাস্টমার, অ্যাকটিভ রাইডার, অ্যাকটিভ ডেলিভারি—সব দেখা যাবে। আপনি চাইলে অর্ডার ক্যানসেল, রাইডার রিপ্লেস, বা ম্যানুয়াল ডিসপ্যাচ—সবকিছু কন্ট্রোল করতে পারবেন। ডিসপ্যাচ সেটিং-এ একবারে একজন রাইডারকে ডেলিভারি অফার যাবে। ৩০ সেকেন্ড টাইমআউট থাকবে, না একসেপ্ট করলে পরের জনকে অফার যাবে। অ্যাডমিন প্যানেলে পুরো কন্ট্রোল থাকবে— অর্ডার, ভেন্ডর, রাইডার, কাস্টমার, সিটি, ফাইন্যান্স, সাবস্ক্রিপশন, প্রোডাক্ট, কাস্টমার, স্টাফ, রিপোর্ট, নোটিফিকেশন, ওয়েবসাইট, আর সিকিউরিটি সব এক জায়গা থেকে ম্যানেজ করতে পারবেন। অনলাইন সেলস, অর্ডার কন্ট্রোল, ডেলিভারি কন্ট্রোল, লাইভ ট্র্যাকিং, অ্যানালিটিকস, সিটির পারফরম্যান্স— সবকিছুই এক জায়গা থেকে দেখা ও নিয়ন্ত্রণ করতে পারবেন। আমি আপনাকে একটা এন্টারপ্রাইজ লেভেলের সুপার অ্যাডমিন প্যানেল প্রম্পট লিখে দিচ্ছি— এটা কপি করে ডেভেলপারকে দিবেন। আর ড্যাশবোর্ডে টোটাল সেলস, অর্ডার, ভেন্ডর, রাইডার, স্টাফ, সিটি, ফাইন্যান্স, অর্ডার কন্ট্রোল—সবই এক জায়গা থেকে চালাতে পারবেন। সুপার অ্যাডমিন সব কিছুর ওপরে থাকবে, বাকি সবার কাজ হবে নির্ধারিত স্কোপে। এতে আপনি সারাদেশে ১০০ সিটি, হাজার ভেন্ডর বা রাইডার থাকলেও সহজেই কন্ট্রোল করতে পারবেন। আমার পরামর্শ, অ্যাডমিন প্যানেলকে শুধু ইনফরমেশন দেখার ড্যাশবোর্ড না বানিয়ে পুরো মার্কেটপ্লেসের সেন্ট্রাল অপারেশন ও কন্ট্রোল সিস্টেম হিসেবে তৈরি করতে বলবেন।

# Source assistant message 241

হ্যাঁ, **Bangla QR সম্পর্কে জানি।** এটি বাংলাদেশ ব্যাংকের চালু করা জাতীয় Interoperable QR Payment System। আপনার Marketplace-এ এটি যুক্ত করা সম্ভব হতে পারে, এবং Online Payment-এর পাশাপাশি COD-ও থাকবে।

তবে আপনার ব্যবসার জন্য একটি গুরুত্বপূর্ণ বিষয় আছে: **Bangla QR শুধু বিকাশের QR-এর মতো আরেকটি QR কোড নয়; এটি বিভিন্ন ব্যাংক ও MFS-এর মধ্যে একই QR দিয়ে পেমেন্ট করার জাতীয় ব্যবস্থা।**

বাংলাদেশ ব্যাংকের নির্দেশনা অনুযায়ী, ১ অক্টোবর ২০২৬ থেকে Bangla QR পেমেন্টের টাকা সংশ্লিষ্ট Merchant-এর অ্যাকাউন্টে তাৎক্ষণিকভাবে জমা দেওয়ার ব্যবস্থা কার্যকর হয়েছে। citeturn907604search0turn907604search5

### আপনার Marketplace-এ Bangla QR কীভাবে কাজ করবে?

কাস্টমার Checkout-এ তিনটি Payment Option দেখতে পাবেন:

| Payment Method | কীভাবে পেমেন্ট হবে |
|---|---|
| Online Payment | সমর্থিত Gateway দিয়ে |
| Bangla QR | QR Scan করে ব্যাংক/MFS অ্যাপ দিয়ে |
| Cash on Delivery | পণ্য হাতে পেয়ে Rider-কে টাকা দিয়ে |

Bangla QR-এর ক্ষেত্রে:

1. কাস্টমার Checkout-এ Bangla QR নির্বাচন করবেন।
2. সিস্টেম অর্ডারের জন্য QR তৈরি করবে।
3. কাস্টমার নিজের ব্যাংক বা MFS অ্যাপ দিয়ে QR Scan করবেন।
4. পেমেন্ট Confirm করবেন।
5. Acquirer/Payment Provider থেকে Transaction Verification পাওয়ার পর অর্ডার `PAID` হবে।
6. কাস্টমার ও Marketplace উভয়েই পেমেন্টের রেকর্ড পাবেন।

বাংলাদেশ ব্যাংকের ২০২১ সালের নির্দেশিকায় Static ও Dynamic QR—দুই ধরনের ব্যবস্থাই রয়েছে। Dynamic QR-এ নির্দিষ্ট Amount ও Bill Number যুক্ত করা যায়। citeturn493300view1

### আপনার Marketplace-এর জন্য গুরুত্বপূর্ণ সতর্কতা

আপনার আগের পরিকল্পনা ছিল—কাস্টমারের টাকা Marketplace-এর মাধ্যমে সংগ্রহ হবে এবং ডেলিভারি সফল হলে Vendor Settlement হবে।

কিন্তু Bangla QR-এর ক্ষেত্রে Merchant-এর পরিচয় এবং টাকা কোন অ্যাকাউন্টে জমা হবে, সেটি Acquirer নির্ধারণ করে। বাংলাদেশ ব্যাংকের নির্দেশনা অনুযায়ী, ১ অক্টোবর ২০২৬ থেকে Bangla QR পেমেন্ট সংশ্লিষ্ট Merchant-এর অ্যাকাউন্টে তাৎক্ষণিক জমা দেওয়ার নির্দেশ কার্যকর হয়েছে। citeturn907604search0

তাই দুটি বিষয় আলাদা করে বুঝতে হবে:

- প্রতিটি Vendor-এর নিজস্ব Bangla QR থাকলে টাকা সরাসরি সংশ্লিষ্ট Vendor-এর অ্যাকাউন্টে যেতে পারে।
- Marketplace-এর নিজস্ব Merchant Account-এর QR ব্যবহার করলে টাকা Marketplace-এর অ্যাকাউন্টে যেতে পারে, তবে Multi-vendor পেমেন্ট সংগ্রহ ও পরবর্তী Settlement-এর জন্য Acquirer-এর অনুমোদিত Marketplace/Aggregator ব্যবস্থা থাকতে হবে।

অর্থাৎ সাধারণ QR কোড তৈরি করলেই আপনার পছন্দের Settlement Model কার্যকর হবে না।

### Developer-এর জন্য Bangla QR Requirements

```text
ADD BANGLA QR PAYMENT INTEGRATION

Add Bangla QR as a separate payment method
alongside Online Payment and Cash on Delivery.

Requirements:

1. Integrate through a Bangladesh Bank-approved
   Bangla QR Acquirer/Payment Provider.

2. Support dynamic, order-specific QR generation
   if the provider API supports it.

3. Include order reference and exact payable amount.

4. Display QR on the checkout payment screen.

5. Support QR scanning and QR image upload
   where supported by the payment provider.

6. Verify payment through trusted provider APIs
   or authenticated callbacks.

7. Never confirm payment using screenshots
   or client-side success messages.

8. Prevent duplicate payment processing.

9. Store transaction ID, merchant ID,
   order ID, amount, timestamp and status.

10. Handle pending, successful, failed,
    reversed and disputed transactions.

11. Maintain separate vendor financial ledgers.

12. Support multi-vendor order allocation.

13. Preserve COD and existing online payment methods.

14. Follow Bangladesh Bank regulations
    and the Acquirer's merchant settlement rules.

15. Do not assume delayed vendor settlement
    is permitted without an approved arrangement.
```

বাংলাদেশ ব্যাংকের Bangla QR Dispute Resolution Guidelines-এ Failed Transaction, Automatic Reversal এবং Dispute Management-এর নিয়মও রয়েছে। সেগুলোও Payment Module-এ বিবেচনা করতে হবে। citeturn493300view0

### আপনার কাছে একটি গুরুত্বপূর্ণ সিদ্ধান্ত জানতে চাই

আপনি কি চান **একটি Central Marketplace Bangla QR** থাকবে, যেটি দিয়ে সব Vendor-এর পণ্যের পেমেন্ট নেওয়া হবে এবং Vendor-wise হিসাব আপনার Admin Panel-এ থাকবে?

নাকি প্রত্যেক Vendor-এর আলাদা Bangla QR থাকবে?

আপনার আগের Centralized Settlement পরিকল্পনার সঙ্গে প্রথম পদ্ধতিটি বেশি সামঞ্জস্যপূর্ণ—তবে সেটি Payment Provider-এর অনুমোদন সাপেক্ষে বাস্তবায়ন করতে হবে।

# Source assistant message 268

আপনার Marketplace-এ Vendor-দের পেমেন্ট করার জন্য **Vendor Wallet + Settlement System** রাখবেন। অর্থাৎ প্রতিটি Vendor-এর বিক্রির হিসাব আলাদা থাকবে। অর্ডার সফলভাবে ডেলিভারি হওয়ার পর আপনার কমিশন ও অন্যান্য প্রযোজ্য চার্জ বাদ দিয়ে Vendor-এর পাওনা হিসাব হবে। এরপর সপ্তাহে নির্ধারিত দিনে Vendor নিজের পাওনা তুলতে পারবেন, অথবা Admin পেমেন্ট পাঠাবেন।

এটি Rider Wallet থেকে আলাদা হবে। Rider-এর টাকা ও Vendor-এর টাকা কখনো একই Wallet বা Ledger-এ মেশানো যাবে না।

### ১. Vendor Payment-এর উদাহরণ

ধরুন, একজন Vendor-এর পণ্য বিক্রি হলো:

| হিসাব | টাকা |
|---|---:|
| পণ্যের মূল্য | ৳১,০০০ |
| Marketplace Commission (১০%) | -৳১০০ |
| Vendor-এর পাওনা | ৳৯০০ |

যদি কাস্টমার ৳৫০ Delivery Charge দেন, সেটি আলাদা Delivery Ledger-এ হিসাব হবে। Rider-এর পাওনা এবং Marketplace-এর Delivery Revenue-ও আলাদাভাবে হিসাব হবে।

### ২. Vendor টাকা কীভাবে পাবেন?

আপনার Vendor Dashboard-এ থাকবে:

- Total Sales
- Delivered Order Amount
- Marketplace Commission
- Refund / Adjustment
- Pending Settlement
- Available for Withdrawal
- Total Paid
- Settlement History
- Bank / MFS Account Details

আপনি চাইলে Rider-এর মতো Vendor-দের জন্যও সপ্তাহে দুই দিন Settlement Day নির্ধারণ করতে পারবেন। যেমন বুধবার ও শনিবার।

### ৩. তিন ধরনের পেমেন্টে Vendor Settlement

| Customer Payment | Vendor-এর টাকা কীভাবে হিসাব হবে |
|---|---|
| Online Payment | Gateway-এর নিশ্চিত পেমেন্ট থেকে Vendor-এর পাওনা হিসাব |
| Bangla QR | Acquirer-এর অনুমোদিত Merchant Settlement অনুযায়ী |
| COD | Rider-এর সংগৃহীত টাকা কোম্পানিতে জমা ও যাচাই হওয়ার পর Vendor-এর পাওনা হিসাব |

বিশেষ করে COD-এর ক্ষেত্রে Rider টাকা সংগ্রহ করলেই Vendor-কে পেমেন্ট করা যাবে না। কোম্পানির কাছে টাকা জমা হয়েছে কি না, সেটিও যাচাই করতে হবে।

### ৪. Vendor-কে টাকা পাঠানোর পদ্ধতি

প্রাথমিকভাবে দুটি পদ্ধতি রাখুন:

1. **Bank Transfer:** Vendor-এর নিবন্ধিত ব্যাংক অ্যাকাউন্টে টাকা পাঠানো।
2. **MFS Payout:** অনুমোদিত Disbursement API থাকলে Vendor-এর নিবন্ধিত MFS অ্যাকাউন্টে টাকা পাঠানো।

শুরুতে Admin Payment Approve করবেন। পরে Provider-এর API দিয়ে Automated Payout চালু করা যাবে।

### ৫. গুরুত্বপূর্ণ: Bangla QR-এর ক্ষেত্রে একটি নিয়ম

একটি গুরুত্বপূর্ণ বিষয় পরিষ্কার করা দরকার। বাংলাদেশ ব্যাংকের নির্দেশনা অনুযায়ী, ১ অক্টোবর ২০২৬ থেকে Bangla QR পেমেন্ট সংশ্লিষ্ট Merchant-এর অ্যাকাউন্টে তাৎক্ষণিকভাবে Settlement করার নির্দেশ কার্যকর হয়েছে। ফলে আপনার পরিকল্পিত Central QR থেকে টাকা আটকে রেখে পরে Vendor-কে দেওয়ার ব্যবস্থা সাধারণ Merchant QR দিয়ে করা যাবে—এমন ধরে নেওয়া যাবে না। আপনার Acquirer-এর অনুমোদিত Marketplace বা Sub-merchant Settlement Model লাগতে পারে। citeturn487220search10turn487220search0

### ৬. Developer-এর জন্য Vendor Settlement নির্দেশনা

```text
IMPLEMENT VENDOR WALLET AND SETTLEMENT SYSTEM

1. Create a separate financial ledger for every vendor.

2. Track:
   - Total Sales
   - Delivered Sales
   - Marketplace Commission
   - Refunds
   - Adjustments
   - Pending Settlement
   - Available Settlement
   - Completed Payouts

3. Calculate vendor payable automatically.

4. Make settlement eligible only after successful
   delivery and configured verification checks.

5. Configure two weekly settlement days.

6. Support bank transfers and approved MFS payouts.

7. Allow vendors to view their complete financial history.

8. Require admin approval for initial payouts.

9. Support automated payouts through approved APIs later.

10. Prevent duplicate settlements and payouts.

11. Maintain immutable financial ledgers.

12. Reconcile online payments, Bangla QR and COD separately.

13. Never assume Bangla QR funds can be held for
    delayed settlement. Follow the acquirer's approved
    merchant and sub-merchant settlement arrangement.

14. Maintain complete audit logs for every transaction.
```

বাংলাদেশ ব্যাংকের Payment and Settlement Systems Act, 2024 এবং অনুমোদিত Payment Provider-এর শর্ত মেনে এই ব্যবস্থা তৈরি করতে হবে। citeturn487220search4turn487220search3

### আমার একটি প্রশ্ন

আপনি কি চান Vendor-রা নিজেরাই Dashboard থেকে **Withdraw Request** করবে, নাকি আপনার Admin Panel থেকে হিসাব দেখে আপনি নির্ধারিত দিনে সরাসরি তাদের টাকা পাঠাবেন?

আমার প্রস্তাব: দুটি ব্যবস্থাই রাখুন—Vendor নিজের পাওনা দেখতে পারবে, আর Admin নির্ধারিত দিনে Settlement অনুমোদন ও সম্পন্ন করবেন।

# Source assistant message 280

আচ্ছা, বাংলাদেশে রাইডার ও ভেন্ডর— দুজনের জন্যই আলাদা KYC ভেরিফিকেশন সিস্টেম রাখা উচিত। এতে আপনার প্ল্যাটফর্মে কে ভেন্ডর্ডর হিসেবে ব্যবসা কাজ করছে, কে রাইডার হিসেবে ডেলিভারি দিচ্ছে, আর তাদের বৈধতা যাচাই করতে পারবেন, কিন্তু বাংলাদেশের ব্যক্তিগত উপাত্ত সুরক্ষা আইন ২০২ আইন ২০২ ৬ অনুযায়ী আপনাকে বলছি, আপনি ভেন্ডর ও রাইডার— দুইজনের জন্য ই আলাদা KYC ভেরিফিকেশন মডিউল রাখুন। ভেন্ডরের জন্য NID, ট্রেড লাইসেন্স, ব্যাংক বা MFS অ্যাকাউন্ট ডিটেইল স, স্টোরের তথ্য— এগুলো লাগবে। রাই ডারের ক্ষেত্রে NID, ড্রাইভিং লাই সেন্স (য দি মোট রযান চালায়), প্রোফাইল ছবি, ঠিকানা, জরুরি কন ট্যাক্ট— এগুলো লাগবে। আপনার অ্যাড মিন প্যানেলে একটা KYC মডিউল রাখবেন, যেখানে পেন্ডিং, অ্যাপ্রুভ ড, রিজেক্টেড, এক্স পায়ারড স্ট্যাটাস থাকবে। ডকুমেন্ট এনক্রিপ্টেড স্টোরেজে রাখবেন, পাবলিক ইউআর এলে না। অ্যাড মিন স্টাফ ছাড়া কেউ দেখতে পারবে না, আর কে কখন ডকুমেন্ট দেখেছে তার লগ রাখতে হবে। প্রাই ভেসি পলিসি আপডেট করবেন, আইন অনুযায়ী কী সংগ্রহ করছেন, কতদিন রাখবেন, কার সঙ্গে শেয়ার হবে— সব পরিষ্কার লিখবেন। আমার সাজেশন হলো, দুই পদ্ধ তিই রাখুন— অ্যাপে আপলোডের সুবিধা থাকবে, আবার প্রয়োজনে অফিসে কাগ জপ ত্র জমা হলেও অ্যাড মিন আপলোড করবে। এতে অনলাই নে রেজিস্ট্রেশন সহজ হবে, আবার ভেরিফিকেশনও শক্ত থাকবে। ডেভেলপার কে স্পষ্ট ভাবে বলতে হবে, অ্যাপ্রুভাল না হওয়া পর্যন্ত ভেন্ডর প্রোডাক্ট বিক্রি করতে পারবে না, আর রাই ডার ডেলিভারি নিতে পারবে না।

# Source assistant message 281

হ্যাঁ, আপনার Marketplace-এ Vendor ও Rider—দুজনের জন্যই আলাদা **KYC (Know Your Customer), Identity Verification এবং Document Verification System** রাখা উচিত। এতে আপনার প্ল্যাটফর্মে কে Vendor হিসেবে ব্যবসা করছে, কে Rider হিসেবে ডেলিভারি দিচ্ছে এবং তাদের পরিচয় ও ব্যবসার বৈধতার প্রমাণ কী—সবকিছু Admin Panel থেকে নিয়ন্ত্রণ করতে পারবেন।

বাংলাদেশে এ ধরনের তথ্য সংগ্রহের ক্ষেত্রে একটি গুরুত্বপূর্ণ বিষয় আছে: **আপনি পরিচয়পত্র চাইতে পারবেন, তবে প্রয়োজন অনুযায়ী, নির্দিষ্ট উদ্দেশ্যে এবং ব্যক্তিগত তথ্য সুরক্ষার নিয়ম মেনে সংগ্রহ করতে হবে।**

বাংলাদেশের ব্যক্তিগত উপাত্ত সুরক্ষা আইন, ২০২৬ অনুযায়ী NID নম্বর ও পরিচয়সংক্রান্ত তথ্য ব্যক্তিগত উপাত্ত। বায়োমেট্রিক তথ্য সংবেদনশীল ব্যক্তিগত উপাত্ত। সম্মতি, তথ্যের ব্যবহার, নিরাপত্তা ও সংরক্ষণের সময়সীমার বিষয়ে আইনটিতে শর্ত রয়েছে। citeturn255182view0turn742246view0turn742246view1

## ১. Vendor Verification System

Vendor-দের দুই ধরনের পরিচয় হতে পারে:

- Individual / Sole Proprietor — একজন ব্যক্তি নিজের ব্যবসা পরিচালনা করেন।
- Registered Business / Company — নিবন্ধিত প্রতিষ্ঠান বা কোম্পানি।

**একজন Individual Vendor-এর কাছ থেকে:**

| Document | উদ্দেশ্য |
|---|---|
| NID Card | পরিচয় যাচাই |
| Passport | বিকল্প পরিচয়পত্র, প্রযোজ্য ক্ষেত্রে |
| Trade License | ব্যবসার বৈধতার প্রমাণ |
| Business Address Proof | ব্যবসার ঠিকানা যাচাই |
| Bank / MFS Account Information | Vendor Payment |
| Business Phone Number | যোগাযোগ যাচাই |
| Store / Business Photos | ব্যবসার বাস্তবতা যাচাই |

**একটি Registered Company-এর কাছ থেকে:**

- Certificate of Incorporation, যদি কোম্পানি নিবন্ধিত হয়।
- Trade License।
- কোম্পানির TIN / e-TIN, প্রযোজ্য ক্ষেত্রে।
- BIN / VAT Registration, প্রযোজ্য ক্ষেত্রে।
- Authorized Representative-এর NID।
- Board Resolution বা Authorization Letter, প্রয়োজন হলে।
- Company Bank Account Information।
- Business Address এবং Contact Information।

বিশেষ কিছু পণ্য যেমন ওষুধ, খাদ্য বা নিয়ন্ত্রিত পণ্য বিক্রির ক্ষেত্রে পণ্যের ধরন অনুযায়ী অতিরিক্ত লাইসেন্স বা অনুমোদন লাগতে পারে।

**আমার পরামর্শ:** Vendor-এর NID এবং Trade License—এই দুটি দিয়ে সাধারণ ব্যবসায়িক যাচাই শুরু করুন। ব্যবসাটি কোম্পানি হিসেবে নিবন্ধিত হলে তার Registration Documents-ও নিন।

## ২. Rider Verification System

Rider-এর ক্ষেত্রে পরিচয় এবং যানবাহন—দুটিই যাচাই করবেন।

| Document | কখন প্রয়োজন |
|---|---|
| NID Card | পরিচয় যাচাই |
| Passport | বিকল্প পরিচয়পত্র |
| Driving License | মোটরযান চালালে |
| Vehicle Registration | নিজের মোটরযান ব্যবহার করলে |
| Fitness Certificate | প্রযোজ্য মোটরযানের ক্ষেত্রে |
| Updated Tax Token | প্রযোজ্য মোটরযানের ক্ষেত্রে |
| Vehicle Insurance | প্রযোজ্য ক্ষেত্রে |
| Profile Photo | Rider পরিচিতির জন্য |
| Emergency Contact | জরুরি যোগাযোগ |
| Address Information | ঠিকানা যাচাই |

যদি Rider সাইকেল ব্যবহার করেন, তাহলে মোটরযানের Driving License বা Registration Document চাওয়ার দরকার নেই।

BRTA-এর তথ্য অনুযায়ী, মোটরযান চালানোর জন্য কার্যকর Driving License প্রয়োজন। Ride-sharing-এর নির্দিষ্ট ক্ষেত্রে BRTA মালিক ও চালকের NID, Driving License এবং যানবাহনের কাগজপত্রের কথাও উল্লেখ করেছে। citeturn264500search1turn264500search12

## ৩. Admin Panel-এ Document Verification System

আপনার Admin Panel-এ নতুন একটি মডিউল রাখুন:

**KYC & Verification Management**

এখানে থাকবে:

| Feature | কাজ |
|---|---|
| Pending Verification | যাদের ডকুমেন্ট যাচাই বাকি |
| Approved | যাদের যাচাই সম্পন্ন |
| Rejected | যাদের ডকুমেন্ট বাতিল |
| Re-upload Required | নতুন ডকুমেন্ট প্রয়োজন |
| Expired Documents | মেয়াদ শেষ হওয়া কাগজপত্র |
| Verification History | কে কখন যাচাই করেছে |
| Document Management | ডকুমেন্ট দেখা ও পরিচালনা |
| Risk Alerts | সন্দেহজনক বা অসংগত তথ্য |

Admin প্রতিটি ডকুমেন্ট আলাদাভাবে Approve বা Reject করতে পারবেন। Reject করলে কারণ লিখতে হবে।

## ৪. Vendor ও Rider Registration Workflow

```text
Registration
     ↓
Personal Information
     ↓
Phone Verification (OTP)
     ↓
Document Upload
     ↓
Consent & Privacy Notice
     ↓
Admin KYC Review
     ↓
Document Verification
     ↓
Approved / Rejected
     ↓
Account Activation
```

একটি গুরুত্বপূর্ণ নিয়ম রাখবেন:

- KYC Approved না হলে Vendor পণ্য বিক্রি করতে পারবেন না।
- KYC Approved না হলে Rider কোনো Delivery গ্রহণ করতে পারবেন না।
- Document Expired হলে সংশ্লিষ্ট কার্যক্রম সাময়িকভাবে সীমিত করা যাবে।
- Suspended Vendor বা Rider কোনো নতুন কাজ করতে পারবেন না।

## ৫. Document Security ও Privacy Protection

এটি খুবই গুরুত্বপূর্ণ। আপনার কাছে মানুষের NID, Passport ও অন্যান্য ব্যক্তিগত ডকুমেন্ট থাকবে। তাই:

1. ডকুমেন্ট Public URL-এ রাখা যাবে না।
2. Private Storage ও Encryption ব্যবহার করতে হবে।
3. শুধু অনুমোদিত Admin ও Verification Staff ডকুমেন্ট দেখতে পারবেন।
4. কে কখন ডকুমেন্ট দেখেছেন, তার Audit Log রাখতে হবে।
5. ডকুমেন্ট কেন সংগ্রহ করছেন, কতদিন রাখবেন এবং কার সঙ্গে শেয়ার হতে পারে—Privacy Policy-তে জানাতে হবে।
6. সম্মতি প্রত্যাহার, তথ্য সংশোধন এবং আইন অনুযায়ী মুছে ফেলার অনুরোধ পরিচালনার ব্যবস্থা রাখতে হবে।
7. প্রয়োজন শেষ হলে আইনসম্মত Retention Period অনুযায়ী ডকুমেন্ট মুছে ফেলতে বা Anonymize করতে হবে।
8. NID বা Passport-এর ছবি কখনো অন্য Vendor বা Rider-কে দেখানো যাবে না।

আইনটির ধারা ৫, ৭, ১৫, ১৭ ও ১৮-তে সম্মতি, সংবেদনশীল তথ্য, স্বচ্ছতা, নিরাপত্তা এবং তথ্য সংরক্ষণের বিষয়ে বিধান রয়েছে। citeturn742246view0turn742246view1

আরেকটি বিষয়: বাংলাদেশ ব্যাংকের e-KYC Guideline মূলত ব্যাংক, Finance Company, MFS ও Payment Service Provider-দের জন্য। আপনার Marketplace নিজে শুধু NID-এর ছবি আপলোড করিয়ে সরকারি NID Database Verification করতে পারবে—এমন ধরে নেওয়া যাবে না। এজন্য অনুমোদিত Verification Service বা সংশ্লিষ্ট কর্তৃপক্ষের অনুমতি প্রয়োজন হতে পারে। citeturn255182view2

## ৬. Developer-এর জন্য Master Implementation Prompt

নিচের নির্দেশনাটি আপনার Marketplace-এর মূল Developer Prompt-এ যোগ করবেন।

```text
MODULE: KYC, IDENTITY & DOCUMENT VERIFICATION

Build a complete KYC and Document Verification
System for Vendors and Riders.

A. VENDOR KYC

Support:
- Individual / Sole Proprietor
- Registered Company / Business

Collect documents as applicable:
- NID
- Passport (alternative ID)
- Trade License
- Certificate of Incorporation
- TIN / e-TIN
- BIN / VAT Registration
- Business Address Proof
- Authorized Representative ID
- Authorization Letter / Board Resolution
- Bank / MFS Account Information
- Additional category-specific permits

B. RIDER KYC

Collect:
- NID
- Passport (alternative ID)
- Profile Photo
- Address Information
- Emergency Contact
- Driving License (if operating a motor vehicle)
- Vehicle Registration (if applicable)
- Fitness Certificate (if applicable)
- Tax Token (if applicable)
- Insurance (if applicable)

C. DOCUMENT VERIFICATION

Implement:
- Pending Verification
- Approved
- Rejected
- Re-upload Required
- Expired
- Suspended

Admin must be able to:
- Review uploaded documents.
- Approve or reject individual documents.
- Add rejection reasons.
- Request updated documents.
- Track document expiry.
- View complete verification history.
- Assign verification tasks to authorized staff.

D. ACCOUNT ACTIVATION RULES

- Vendors cannot publish products or receive
  orders until required KYC is approved.
- Riders cannot accept deliveries until
  required KYC is approved.
- Expired mandatory documents trigger
  configurable account restrictions.
- Suspended accounts cannot perform new operations.

E. SECURITY & PRIVACY

- Use private encrypted document storage.
- Never expose documents through public URLs.
- Implement role-based document access.
- Maintain document access audit logs.
- Record informed and specific consent.
- Display a clear Privacy Notice.
- Support data access and correction requests.
- Implement lawful retention and deletion policies.
- Never collect fingerprints or biometric templates
  without a valid legal basis and required safeguards.
- Do not claim government NID verification unless
  an authorized verification service confirms it.

F. ADMIN DASHBOARD

Create a dedicated KYC & Verification module
with vendor-wise and rider-wise verification reports.

All verification actions must be timestamped
and linked to the responsible staff member.
```

## আমার চূড়ান্ত পরামর্শ

আপনার সিস্টেমে তিনটি আলাদা Verification Level রাখুন:

- **Level 1 – Identity Verified:** ব্যক্তির পরিচয় যাচাই সম্পন্ন।
- **Level 2 – Business / Vehicle Verified:** Vendor-এর ব্যবসা অথবা Rider-এর যানবাহনের প্রয়োজনীয় কাগজপত্র যাচাই সম্পন্ন।
- **Level 3 – Fully Approved:** Admin-এর চূড়ান্ত অনুমোদন সম্পন্ন।

এতে ভবিষ্যতে Mymensingh থেকে Dhaka, Chattogram বা অন্য শহরে Marketplace সম্প্রসারণ করলেও একই Verification System ব্যবহার করতে পারবেন।

**একটি বিষয় জানতে চাই:** আপনি কি চান Vendor ও Rider-রা নিজেরাই মোবাইল অ্যাপ বা Dashboard থেকে NID, Trade License, Driving License ইত্যাদির ছবি তুলে Upload করবে, নাকি প্রথমে আপনার অফিসে সরাসরি কাগজপত্র জমা দিয়ে Admin সেগুলো Upload করবে?

আমার সুপারিশ—দুই পদ্ধতিই রাখুন। এতে অনলাইনে Registration সহজ হবে, আবার প্রয়োজন হলে সরাসরি কাগজপত্র যাচাইও করতে পারবেন।

# Source assistant message 297

হ্যাঁ, আপনার ধারণাটা ঠিক—আপনি Vendor ও Rider-এর ডকুমেন্ট **বাংলাদেশ সরকারের সংশ্লিষ্ট Official Website বা অনুমোদিত Verification Service থেকে যাচাই করে তারপর Approve করবেন।** তবে একটা গুরুত্বপূর্ণ পার্থক্য আছে:

**কোনো ব্যক্তির NID বা Driving License সত্যি কি না যাচাই করা এবং তিনি বাংলাদেশের নাগরিক কি না নিশ্চিত করা—দুটি এক বিষয় নয়।**

আপনার Marketplace-এ এই যাচাইগুলো আলাদা করে রাখতে হবে।

## ১. কোন সরকারি ওয়েবসাইট থেকে যাচাই করবেন?

আমি সরকারি উৎসগুলো দেখে কয়েকটি কার্যকর Verification Portal পেয়েছি:

| ডকুমেন্ট | সরকারি উৎস | কী যাচাই করা যায় |
|---|---|---|
| NID | [বাংলাদেশ নির্বাচন কমিশন](https://www.nidw.gov.bd/) | NID-সংক্রান্ত অনুমোদিত যাচাই |
| Driving License | [BRTA License Verification](https://www.bsp.brta.gov.bd/dlVerification?lan=en) | লাইসেন্সের তথ্য |
| Trade License | [E-Trade License Verification](https://www.etradelicense.gov.bd/ULicVerify) | লাইসেন্স নম্বর, ব্যবসার নাম, অবস্থা |
| Passport | [Department of Immigration and Passports](https://www.passport.gov.bd/) | পাসপোর্ট-সংক্রান্ত সরকারি সেবা; সাধারণ Marketplace-এর জন্য উন্মুক্ত পূর্ণাঙ্গ Passport Verification API নিশ্চিত নয় |

BRTA-এর পোর্টালে Driving License Reference Number এবং First Issue Date দিয়ে যাচাই করার ব্যবস্থা আছে। citeturn618642search1turn618642search3

E-Trade License পোর্টালে Trade License Number দিয়ে লাইসেন্সধারী, ব্যবসার নাম এবং লাইসেন্সের অবস্থা যাচাইয়ের ব্যবস্থা রয়েছে। citeturn618642search0

## ২. NID Verification-এর ক্ষেত্রে বিশেষ সতর্কতা

বাংলাদেশ নির্বাচন কমিশনের NID Database সাধারণ কোনো Public Database নয়।

নির্বাচন কমিশনের তথ্য অনুযায়ী, ব্যক্তি ও প্রতিষ্ঠান কর্তৃক তথ্য যাচাই বা তথ্য সরবরাহের জন্য নির্দিষ্ট আবেদন ফর্ম রয়েছে। আপনার কোম্পানি সরাসরি NID Database API ব্যবহার করতে পারবে—এমন ধরে নেওয়া যাবে না। citeturn618642search15turn618642search11

আপনার করণীয়:

- Vendor বা Rider-এর সম্মতি নেবেন।
- তাদের NID তথ্য সংগ্রহের উদ্দেশ্য জানাবেন।
- নির্বাচন কমিশনের কাছে আপনার প্রতিষ্ঠানের জন্য অনুমোদিত Verification Access পাওয়া যায় কি না জানতে চাইবেন।
- অনুমোদন ছাড়া কোনো অননুমোদিত NID Database বা API ব্যবহার করবেন না।

সরকারি NID Portal: https://www.nidw.gov.bd/

## ৩. আপনার Admin Panel-এ কীভাবে কাজ করবে?

আমি একটি Central Verification Dashboard রাখার পরামর্শ দিচ্ছি।

```text
VENDOR / RIDER REGISTRATION
          ↓
DOCUMENT UPLOAD
          ↓
CONSENT & PRIVACY NOTICE
          ↓
ADMIN VERIFICATION DASHBOARD
          ↓
OFFICIAL SOURCE VERIFICATION
          ↓
DOCUMENT AUTHENTICITY CHECK
          ↓
IDENTITY / BUSINESS CHECK
          ↓
ADMIN FINAL REVIEW
          ↓
APPROVED / REJECTED
```

প্রতিটি ডকুমেন্টের জন্য চারটি Status রাখবেন:

- `PENDING_VERIFICATION`
- `VERIFIED`
- `REJECTED`
- `MANUAL_REVIEW_REQUIRED`

উদাহরণ: একজন Rider-এর NID যাচাই হয়েছে, কিন্তু Driving License যাচাই হয়নি। তাহলে NID-কে Verified এবং Driving License-কে Pending রাখবেন।

## ৪. Developer-কে এই নির্দেশনা দিন

```text
OFFICIAL GOVERNMENT DOCUMENT VERIFICATION

Build an official document verification workflow
for all Vendors and Riders.

1. Collect required documents with informed consent.

2. Provide a dedicated Admin Verification Dashboard.

3. Allow authorized verification staff to access
   official government verification portals.

4. Support official APIs only when the company
   has obtained the required authorization.

5. Never scrape restricted government databases
   or use unauthorized NID verification APIs.

6. Verify NID through an authorized Election
   Commission verification service, where available.

7. Verify driving licenses through BRTA.

8. Verify Trade Licenses through the relevant
   government or local authority portal.

9. Support manual verification when no official
   online verification service is available.

10. Maintain separate verification status
    for every document.

11. Record verification source, date, staff member,
    result and reference number.

12. Do not automatically approve a person merely
    because a document image has been uploaded.

13. Final approval requires authorized staff review.

14. Keep all identity documents encrypted
    and access-controlled.
```

## ৫. আমার বিশেষ পরামর্শ

আপনার Approval System-এ দুটি বিষয় আলাদা রাখবেন:

- **Identity Verification:** ব্যক্তির পরিচয় ও পরিচয়পত্রের সত্যতা যাচাই।
- **Eligibility Verification:** তিনি আপনার Marketplace-এ Vendor বা Rider হিসেবে কাজ করার প্রয়োজনীয় শর্ত পূরণ করেন কি না।

একজন ব্যক্তির NID যাচাই হলেই তাঁর ব্যবসা বৈধ প্রমাণিত হয় না। আবার Driving License যাচাই হলেই তাঁর গাড়ির সব কাগজ বৈধ প্রমাণিত হয় না।

এভাবে যাচাই করলে আপনার Marketplace-এ ভুয়া Vendor, ভুয়া Rider এবং জাল ব্যবসায়িক কাগজপত্রের ঝুঁকি অনেকটাই কমবে।

**সবচেয়ে গুরুত্বপূর্ণ সিদ্ধান্ত:** আপনার কোম্পানির জন্য নির্বাচন কমিশনের অনুমোদিত NID Verification Access পাওয়ার সুযোগ ও শর্ত আগে যাচাই করুন। এটিই আপনার সম্পূর্ণ KYC System-এর সবচেয়ে গুরুত্বপূর্ণ সরকারি Integration হবে।

# Source assistant message 306

আপনার Marketplace-এ এই ব্যবস্থাটি রাখা যাবে। এর নাম হবে **Location-Based Service Area & Geofencing System**। এর মাধ্যমে Vendor, Rider এবং Customer—প্রত্যেকের জন্য নির্দিষ্ট শহর, উপজেলা বা সার্ভিস এরিয়া নির্ধারণ করতে পারবেন।

আপনার উদাহরণ অনুযায়ী, ময়মনসিংহ শহরের Rider ময়মনসিংহের নির্ধারিত সার্ভিস এরিয়ার বাইরে ডেলিভারি নিতে পারবে না। আবার পূর্বধলা এলাকার Rider-কে শুধু পূর্বধলার নির্ধারিত এলাকার মধ্যেই কাজ করতে দিতে পারবেন।

তবে একটি বিষয়: প্রশাসনিক সীমানা এবং আপনার ব্যবসার Service Area এক জিনিস নয়। আপনি চাইলে পুরো ময়মনসিংহ বিভাগ চালু না করে শুধু ময়মনসিংহ সিটি বা নির্দিষ্ট কিছু ওয়ার্ড চালু করতে পারবেন।

## ১. Location hierarchy

আপনার Admin Panel-এ এই কাঠামো রাখুন:

```text
Bangladesh
   └── Division
        └── District
             └── Upazila / City
                  └── Service Area / Zone
                       └── Ward / Local Boundary
```

উদাহরণ:

- Mymensingh Division
  - Mymensingh District
    - Mymensingh City Zone
    - Purbadhala Zone
    - অন্যান্য চালু Service Area

প্রতিটি Zone আলাদাভাবে Active বা Inactive করা যাবে।

## ২. Rider-এর Location Restriction

প্রত্যেক Rider-এর জন্য Admin নির্ধারণ করবেন:

- Assigned City
- Assigned Service Area
- Allowed Delivery Zones
- Maximum Delivery Distance
- Current GPS Location
- Shift Status

উদাহরণ:

একজন Rider-এর Assigned Zone যদি Purbadhala হয়, তাহলে সে Purbadhala Zone-এর মধ্যে থাকা Eligible Delivery-ই পাবে।

সে অন্য Zone-এ চলে গেলে:

1. নতুন Delivery Offer বন্ধ হবে।
2. Dashboard-এ Out of Service Area সতর্কতা দেখাবে।
3. Admin Panel-এ Alert যাবে।
4. তার আগে থেকে Assigned Delivery থাকলে সেটি স্বয়ংক্রিয়ভাবে বাতিল হবে না।
5. Admin অনুমতি দিলে সাময়িকভাবে অন্য Zone-এ কাজ করতে পারবে।

**গুরুত্বপূর্ণ:** GPS-এ অবস্থান বদলালেই Rider-এর Account Suspend করবেন না। GPS ভুল, নেটওয়ার্ক সমস্যা বা Location Permission বন্ধ থাকতে পারে। আগে সতর্কতা ও যাচাই রাখুন।

## ৩. Vendor-এর Location Restriction

Vendor Registration-এর সময় তার ব্যবসার ঠিকানা ও GPS Location নিতে হবে।

Admin নির্ধারণ করবেন:
- কোন City-তে Vendor কাজ করতে পারবে।
- কোন Zone-এ পণ্য বিক্রি করতে পারবে।
- কোন কোন Delivery Area-তে পণ্য পাঠাতে পারবে।

উদাহরণ: Purbadhala-এর একজন Vendor শুধু Purbadhala Zone-এর কাস্টমারদের কাছে পণ্য বিক্রি করতে পারবেন—যদি আপনি সেই নিয়ম চালু করেন।

Vendor চাইলে একাধিক Zone-এ বিক্রি করার অনুমতিও পেতে পারেন।

## ৪. Customer-এর Location-Based Shopping

Customer ওয়েবসাইটে প্রবেশ করলে:

1. Location Permission চাইবে।
2. GPS অথবা নিজের ঠিকানা দিয়ে Location নির্বাচন করতে পারবে।
3. সিস্টেম নির্ধারণ করবে তার এলাকায় কোন Vendor এবং Product পাওয়া যাচ্ছে।
4. Service Area-এর বাইরের Vendor-এর পণ্য অর্ডার করা যাবে না।
5. Delivery Charge ও আনুমানিক সময় তার Zone অনুযায়ী দেখাবে।

Customer চাইলে নিজে ঠিকানা পরিবর্তন করতে পারবেন।

## ৫. Admin Panel-এ Geofencing Map

এটি আপনার জন্য খুব গুরুত্বপূর্ণ একটি Feature।

Admin Google Maps-এর মতো একটি Map-এ নিজেই Service Area তৈরি করতে পারবেন।

যেমন:

- Mymensingh City Zone
- Purbadhala Zone
- Netrokona Zone
- Dhaka Zone

Admin Map-এ নির্দিষ্ট এলাকার চারপাশে Boundary আঁকবেন। সিস্টেম সেটিকে Geofence হিসেবে সংরক্ষণ করবে।

প্রতিটি Zone-এর জন্য আলাদা:
- Vendor Assignment
- Rider Assignment
- Delivery Charge
- Free Delivery Rules
- Maximum Delivery Distance
- Operating Hours
- Order Availability

রাখতে পারবেন।

## ৬. সিস্টেমটি কীভাবে কাজ করবে?

```text
CUSTOMER PLACES ORDER
         ↓
CHECK CUSTOMER LOCATION
         ↓
CHECK VENDOR SERVICE ZONE
         ↓
CHECK RIDER ELIGIBILITY
         ↓
CHECK DELIVERY DISTANCE
         ↓
SMART RIDER DISPATCH
         ↓
DELIVERY COMPLETED
```

এখানে শুধু মোবাইলের GPS দেখে সিদ্ধান্ত নিলে হবে না। Backend-এ GPS Coordinate-কে আপনার সংরক্ষিত Zone Boundary-এর সঙ্গে যাচাই করতে হবে। এজন্য PostgreSQL-এর PostGIS ব্যবহার করতে পারেন।

## ৭. Developer-এর জন্য Implementation Prompt

```text
MODULE: LOCATION-BASED SERVICE AREA &
GEOFENCING SYSTEM

Build a complete multi-city geofencing system
for the Bangladesh marketplace.

TECHNOLOGY:
- Google Maps Platform
- PostgreSQL + PostGIS
- Next.js + TypeScript
- Backend location validation
- Redis for latest rider locations

ADMIN FEATURES:

1. Create and manage divisions, districts,
   upazilas, cities and service zones.

2. Draw custom service area boundaries
   on an interactive map using polygons.

3. Edit, activate and deactivate service zones.

4. Assign vendors, riders and city managers
   to specific service zones.

5. Configure delivery charges, free delivery,
   operating hours and delivery restrictions.

RIDER FEATURES:

1. Assign each rider to approved service zones.

2. Track GPS location only during authorized
   active shifts and delivery workflows.

3. Prevent new delivery offers outside
   the rider's assigned service zones.

4. Validate rider location on the server.

5. Show out-of-zone warnings.

6. Do not automatically cancel existing deliveries
   when a rider crosses a zone boundary.

7. Allow authorized admin temporary zone overrides.

VENDOR FEATURES:

1. Store verified vendor business coordinates.

2. Assign vendors to one or multiple service zones.

3. Restrict order availability according to
   vendor service zones.

CUSTOMER FEATURES:

1. Allow GPS-based and manual address selection.

2. Check whether the customer's address
   is inside an active service zone.

3. Show only eligible vendors and products.

4. Calculate delivery charges based on service zone.

5. Prevent checkout for unsupported locations.

SMART DISPATCH:

1. Find eligible riders within permitted zones.

2. Calculate road distance and ETA.

3. Dispatch orders using the existing
   sequential rider dispatch system.

4. Prevent unauthorized cross-zone assignments.

SECURITY:

- Perform geofence validation server-side.
- Do not trust client GPS alone.
- Detect stale or inaccurate GPS readings.
- Maintain location access and admin override logs.
- Apply location privacy and retention policies.
- Never expose rider live location to unauthorized users.
```

## ৮. আমার একটি গুরুত্বপূর্ণ পরামর্শ

আপনি যেহেতু প্রথমে ময়মনসিংহে শুরু করবেন, তাই শুরুতে পুরো বাংলাদেশ চালু করার দরকার নেই।

প্রথমে:
- Mymensingh City
- Purbadhala Upazila

এই দুটি আলাদা Service Area হিসেবে তৈরি করুন। পরে Netrokona, Dhaka, Chattogram ইত্যাদি যুক্ত করবেন।

**একটি বিষয় পরিষ্কার করতে চাই:** আপনি কি চান Rider শুধু নিজের Assigned Zone-এর মধ্যেই ডেলিভারি করতে পারবে, নাকি Admin অনুমতি দিলে পাশের Zone-এও ডেলিভারি করতে পারবে?

আমার সুপারিশ, সাধারণ অবস্থায় নিজের Zone এবং বিশেষ অনুমতিতে পাশের Zone—দুই ব্যবস্থাই রাখুন। এতে ভবিষ্যতে অর্ডার বাড়লেও পরিচালনা সহজ হবে।

# Source assistant message 326

হ্যাঁ, একদম সম্ভব, বরং শুরুতেই international ভাবে ডিজাইন করলে পরে USA, UK, UAE বা অন্য দেশে এক্সপ্যান্ড করতে সমস্যা হবে না। আপনার সিস্টেমে রাখবেন— country, multi-currency, multi-language, international payment provider, country-wise delivery zones, geofencing per country, tax configuration per country, আর language support রাখবেন, প্রথমে বাংলা ও ইংরেজি, পরে আরও যোগ হবে। Payment gateway প্লাগেবল রাখবেন, যেন পরে Stripe বা PayPal যোগ করতে হলে সিস্টেম না ভাঙে। Admin dashboard-এ global settings, country management, currency ও exchange rate management, language management, payment ও tax management, আর international shipping management যোগ করবেন। শুরুতে modular monolith architecture রাখুন, microservices পরে ভাববেন। Super Admin পুরো marketplace নিয়ন্ত্রণ করবে, আর country manager তার দেশের মধ্যে অনুমোদিত কাজ করতে পারবে। আর একটা পরিষ্কার প্রশ্ন: ভবিষ্যতে আপনি কি এমন একটা global marketplace চান যেখানে USA থেকে বসে বাংলাদেশের ভেন্ডরের পণ্যও কিনতে পারবে, নাকি প্রতি দেশ আলাদা কিন্তু centrally managed marketplace চান? আমার পরামর্শ, প্রথমে দ্বিতীয়টা নিয়ে এগোন, তবে প্রথমটার জন্যও architecture প্রস্তুত রাখুন। এতে আন্তর্জাতিক expansion অনেক সহজ হবে।

# Source assistant message 328

আ, বুঝে বলছি, একটু সময় দিন। আপনার সিদ্ধান্ত অনুযায়ী, আপনি এখন country-based marketplace হবে, কিন্তু সবকিছুর নিয়ন্ত্রণ থাকবে central super admin-এর হাতে। ভবিষ্যতে যদি USA থেকে বাংলাদেশি ভেন্ডরের কাছ থেকে কেনাকাটা চালু করতে চান, তখন শুধুই super admin একটি feature toggle অন করলেই হবে না। Backend ও database এমনভাবে বানাবেন যাতে পরে cross-border shopping চালু করা যায়। developer কে বলতে পারেন: database extensible রাখুন, country IDs ও currency info store করুন, exchange rate snapshot রাখুন, country-wise authorization backend থেকে enforce করুন, আর payment API শুধু authorized provider দিয়ে integrate করুন। Admin dashboard এ Global Marketplace Configuration নামে একটা module রাখুন, যেখানে cross-border shopping ডিফল্টভাবে বন্ধ থাকবে, চাইলে পরে অন করা যাবে। এইভাবে Bangladesh-first শুরু করে ভবিষ্যতে USA সহ অন্য দেশে expand করা সহজ হবে। এখন আপনি এটাকে এভাবে বলতে পারেন: আমরা প্রথমে বাংলাদেশে চালু করছি, প্রতিটি দেশে আলাদা marketplace থাকবে, কিন্তু architecture এমন থাকবে যাতে ভবিষ্যতে super admin USA বা অন্য দেশের cross-border shopping চালু করতে পারেন, বর্তমান সিস্টেম না ভাঙেই।

# Source assistant message 330

বুঝেছি, একটু দেখে বলছি। আপনি মূলত একটা hierarchical multi-country, multi-region, multi-city ও multi-zone marketplace management system বানাতে চাইছেন, যেখানে প্রতিটি দেশের জন্য আলাদা অপারেশনাল সিস্টেম থাকবে, কিন্তু সবকিছু একটি global super admin dashboard থেকে নিয়ন্ত্রণ করা হবে। উদাহরণ হিসেবে ময়মনসিংহ সিটি ম্যানেজার শুধু ময়মনসিংহ সিটির ভেতরের ভেন্ডর, রাইডার, অর্ডার, ডেলিভারি জোন, জিওফেন্সিং, ডেলিভারি চার্জ, রিপোর্ট—সবকিছু নিয়ন্ত্রণ করবে। Map based boundary system থাকবে, যেখানে অনুমোদিত অ্যাডমিন ম্যাপে সার্ভিস এরিয়া পলিগন আঁকতে পারবে, তারপর ভেন্ডর ও রাইডার সেই জোনে অ্যাসাইন হবে। শুরুতে বাংলাদেশে ময়মনসিংহ সিটি আর পূর্বধলা থেকে শুরু করুন, ভবিষ্যতে অন্য দেশ যোগ করবেন। এই পুরো স্ট্রাকচারটা আপনার বর্তমান Marketplace architecture-এর সঙ্গে integrate করতে হবে, একেবারে নতুন করে না ভেঙে। আপনি ডেভেলপারকে কোডিং শুরু করার আগে architecture diagram, database ERD, geography hierarchy, role & permission matrix, API endpoint plan, geofencing workflow, country & area isolation strategy, আর implementation plan লিখিত আকারে দিয়ে দিন। তাতে করে পুরো সিস্টেমটা পরিষ্কার ও ভবিষ্যত-প্রস্তুতভাবে তৈরি হবে। এটা আপনার marketplace-এর core architecture-এর একটা অংশ হিসেবে ধরবেন।

# Source assistant message 339

ঠিক আছে। একটু সময় দিন। উম। তাহলে আপনার marketplace এর জন্য একটা শক্তিশালী enterprise-grade security ও access control system শুরু থেকেই তৈরি করতে হবে। একদম ১০০% নিরাপত্তার নিশ্চয়তা দেওয়া যায় না, কিন্তু সঠিক architecture, policy, monitoring ও testing দিয়ে ঝুঁকি অনেকটাই কমানো যায়। Role-based access control থাকবে: super admin সবকিছু দেখবে, country admin শুধু নিজের দেশের দেখবে, city বা zone admin শুধু নিজের area দেখবে, vendor শুধু নিজের store, rider শুধু assigned delivery দেখবে। strong authentication থাকবে, admin ও staff এর জন্য MFA বাধ্যতামূলক। database সরাসরি frontend থেকে access করা যাবে না, backend ছাড়া কেউ data touch করতে পারবে না। API তে প্রতিটি request এ permission যাচাই হবে, vendor অন্য vendor এর data দেখতে পারবে না। AI agent যোগ করলে তাদের জন্যও আলাদা identity ও permission লাগবে, sensitive কাজ করতে human approval লাগবে। সবকিছুর audit log রাখা হবে, আর monitoring dashboard থাকবে, যাতে সন্দেহজনক access ধরা যায়। এটা ভুলে যাবেন না, ১০০% নিরাপত্তা কোনো সিস্টেম দিতে পারে না। তাই deny by default নীতি, secure coding practices, encrypted backup ও নিয়মিত security testing রাখলে ঝুঁকি অনেকটাই নিয়ন্ত্রণে থাকবে। আমি developer-এর জন্য একটি security prompt লিখে দিচ্ছি—

# Source assistant message 354

আ,একটু দেখে বলছি। উম... VPN ও location bypass ঠেকাতে ১০০% guarantee দেওয়া যায় না, তবে শক্ত করা যায়। আপনি যে feature চাইছেন, সেটা হলো VPN detection plus GPS spoofing detection plus geofencing plus anti-fraud system। Customer এর জন্য rule হবে, তার delivery address active service zone এর মধ্যে থাকতে হবে। সন্দেহ হলে OTP verification লাগবে। Vendor ও Rider এর জন্য আরও কঠোর নিয়ম হবে। Backend এ Google Play Integrity API ব্যবহার করতে পারেন, IP intelligence provider দিয়ে VPN বা proxy শনাক্ত করতে পারেন, কিন্তু VPN use করলেই সবসময় block করবেন না। কারণ কেউ legit ভাবে VPN ব্যবহার করেও নিজের সঠিক ঠিকানায় অর্ডার করতে পারে। Customer এর জন্য VPN detection হবে একটা risk signal, শেষ সিদ্ধান্ত নয়। Vendor ও Rider এর ক্ষেত্রে জিওফেন্সিং ও device integrity আরও কঠোর হবে। developer প্রম্পটে এটাও যোগ করতে পারেন — "Implement risk-based location security with VPN detection, but do not block legitimate customers solely for VPN use." বলুন, আপনি কি VPN ব্যবহার করলে customer কে অতিরিক্ত verification দিতে বলবেন, নাকি শুধু সন্দেহজনক আচরণ দেখলেই verification চাইবেন? এই সিদ্ধান্তটা নিলে আমরা security flow আরও পরিষ্কারভাবে সাজাতে পারবো।

# Source assistant message 360

বুঝেছি। আপনার নিয়ম হবে: **Customer-এর প্রকৃত বর্তমান GPS Live Location হবে মূল Location Signal; VPN-এর IP Location কখনো প্রকৃত অবস্থান হিসেবে গ্রহণ করা হবে না।**

অর্থাৎ, কেউ VPN চালু করে অন্য দেশের বা অন্য শহরের IP দেখালেও সিস্টেম তার VPN-এর Location দিয়ে সিদ্ধান্ত নেবে না। GPS, Device Integrity এবং Delivery Address মিলিয়ে যাচাই করবে।

তবে একটি বিষয় মনে রাখতে হবে: GPS-ও Fake করা সম্ভব। তাই শুধু GPS দেখেই শতভাগ নিশ্চিত হওয়া যাবে না।

আপনার Customer Verification Flow এমন হওয়া উচিত:

1. Customer Location Permission দেবেন।
2. Backend থেকে GPS Location, Accuracy ও Timestamp যাচাই হবে।
3. VPN বা Proxy শনাক্ত হলে অতিরিক্ত Risk Verification চালু হবে।
4. GPS Location ও Delivery Address-এর মধ্যে অমিল থাকলে Order সাময়িকভাবে Hold হবে।
5. প্রয়োজন হলে OTP এবং Manual Verification হবে।
6. Verification সফল না হওয়া পর্যন্ত সন্দেহজনক Order Confirm হবে না।

**গুরুত্বপূর্ণ:** OTP শুধু ফোন নম্বরের নিয়ন্ত্রণ যাচাই করে, প্রকৃত Location নয়। Location যাচাইয়ের জন্য আলাদা GPS ও Device Integrity Check লাগবে।

### Developer Prompt — Live Location Verification

```text
CUSTOMER LIVE LOCATION & VPN SECURITY POLICY

1. Treat verified device GPS as the primary location
   signal, never VPN-derived IP geolocation.

2. Detect VPN, proxy and suspicious network connections
   using an IP intelligence provider.

3. Request location permission before location-based
   checkout verification.

4. Validate GPS coordinates, accuracy, timestamp,
   device integrity and suspicious mock-location signals.

5. Compare verified GPS coordinates with the customer's
   selected delivery address and active service zone.

6. If VPN is detected, require additional verification.
   VPN detection alone must not establish the customer's
   physical location.

7. If GPS and delivery address significantly disagree:
   - Put the order on temporary hold.
   - Request additional verification.
   - Send suspicious cases for manual review.

8. Never accept frontend-generated location verification
   as authoritative. Perform checks on the backend.

9. If location permission is denied or GPS is unavailable,
   use an alternative verification process or explain
   why location-based ordering cannot proceed.

10. Protect location data and collect it only when
    necessary for checkout and delivery security.
```

### একটি গুরুত্বপূর্ণ নিয়ম

আপনি কি চান Customer-এর বর্তমান Live GPS Location এবং Delivery Address একই Service Zone-এর মধ্যে থাকা বাধ্যতামূলক হবে?

কারণ কেউ নিজের বর্তমান অবস্থান থেকে অন্য জায়গায় থাকা পরিবারের সদস্যের জন্য অর্ডার করতে চাইতে পারে। এই ধরনের অর্ডারও অনুমোদন করবেন কি না, সেটি ঠিক করলে Location Security-এর নিয়ম চূড়ান্ত করা যাবে।

# Source assistant message 372

আপনার এই নতুন সিস্টেমটি অবশ্যই যুক্ত করা উচিত। এর নাম দিতে পারেন **Gift & Remote Ordering System** অথবা **Order for Someone Else**।

এখানে আগের Location Security System-এর একটি গুরুত্বপূর্ণ পরিবর্তন করতে হবে। কারণ এখন থেকে যিনি অর্ডার করবেন এবং যিনি পণ্য গ্রহণ করবেন, তাঁদের একই শহরে থাকা বাধ্যতামূলক হবে না।

### ১. কীভাবে সিস্টেমটি কাজ করবে?

উদাহরণ:

- ক্রেতা ঢাকায় চাকরি করেন।
- তাঁর বোন ময়মনসিংহে থাকেন।
- ক্রেতা ঢাকার বাসা বা অফিস থেকে Marketplace-এ প্রবেশ করবেন।
- Delivery City হিসেবে Mymensingh নির্বাচন করবেন।
- বোনের নাম, ফোন নম্বর ও সম্পূর্ণ ঠিকানা দেবেন।
- সিস্টেম ময়মনসিংহের সংশ্লিষ্ট Service Zone-এর Vendor ও Delivery Availability যাচাই করবে।
- Vendor অর্ডার গ্রহণ করবেন।
- Rider খাবারটি বোনের ঠিকানায় পৌঁছে দেবেন।
- বোন OTP দিয়ে খাবার গ্রহণ নিশ্চিত করবেন।

ক্রেতা ঢাকায় থাকলেও অর্ডারটি ময়মনসিংহে পৌঁছাতে পারবে।

### ২. আগের Location Security-এর সঙ্গে কী পরিবর্তন হবে?

এখন থেকে দুটি আলাদা Location থাকবে:

| Location | কী কাজে ব্যবহার হবে |
|---|---|
| Buyer Live Location | ক্রেতার প্রকৃত অবস্থান ও Security Verification |
| Recipient Delivery Location | কোথায় পণ্য পৌঁছাতে হবে এবং কোন Zone-এর Vendor অর্ডারটি পূরণ করবেন |

**নতুন নিয়ম:**

- Buyer-এর GPS ও Delivery Address একই Zone-এ থাকা বাধ্যতামূলক হবে না।
- Buyer-এর প্রকৃত GPS যাচাই করা হবে।
- VPN বা Proxy শনাক্ত হলে অতিরিক্ত Verification হবে।
- Recipient-এর Delivery Address অবশ্যই Active Service Zone-এর মধ্যে থাকতে হবে।
- ওই Zone-এ Vendor ও Delivery Service Available থাকতে হবে।
- Zone-এর বাইরে Delivery Address হলে Order Confirm করা যাবে না।

### ৩. Developer-এর জন্য Final Prompt

নিচের অংশটি আপনার মূল Marketplace Development Prompt-এ যুক্ত করবেন।

```text
FEATURE: REMOTE ORDERING & ORDER FOR SOMEONE ELSE

OBJECTIVE:
Allow customers to order products or food for another
person located in a different city, district or service
zone within the same country.

1. SEPARATE BUYER AND RECIPIENT
- Maintain separate Buyer and Recipient information.
- Buyer location and Recipient delivery location
  must be treated as two different entities.
- Allow customers to place orders for family members,
  friends or other recipients in different cities.

2. BUYER LOCATION SECURITY
- Verify the Buyer's live GPS location.
- Detect VPN, proxy and suspicious location signals.
- Apply risk-based verification.
- Do not require the Buyer to be physically located
  inside the Recipient's delivery service zone.
- Never use VPN IP location as physical GPS evidence.

3. RECIPIENT DELIVERY LOCATION
- Collect Recipient name and phone number.
- Collect complete delivery address.
- Select destination country, region, district,
  city and active service zone.
- Validate Recipient address against active
  service-zone polygons using PostGIS.
- Verify that eligible vendors and delivery services
  are available in the destination zone.

4. ORDER ROUTING
- Route the order to eligible vendors operating
  in the Recipient's destination service zone.
- Calculate delivery charges and ETA using
  the destination zone.
- Assign riders according to destination-zone rules.
- Keep Buyer and Recipient details separate.

5. PAYMENT
- Allow Buyer to pay using supported payment methods.
- Support prepaid and COD according to platform policy.
- Clearly identify who is responsible for COD payment.
- Never assume the Recipient has already paid.

6. ORDER TRACKING
- Buyer can track the order remotely.
- Recipient can receive order notifications.
- Protect Recipient contact and location information.
- Share tracking information only with authorized users.

7. DELIVERY CONFIRMATION
- Use Recipient OTP or another approved delivery
  verification method.
- Do not disclose OTP to unauthorized users.
- Record delivery completion and timestamp.

8. LOCATION SECURITY EXCEPTION
- Buyer GPS does not need to match Recipient's zone.
- Recipient delivery address MUST belong to an
  active and authorized service zone.
- Orders outside active destination zones must
  be blocked.
- Maintain the original GPS anti-fraud protections.

9. ORDER DATA MODEL
Create separate fields/entities for:
- buyer_id
- buyer_country_id
- buyer_live_location
- recipient_name
- recipient_phone
- recipient_address
- recipient_country_id
- recipient_service_zone_id
- delivery_verification_status

10. FUTURE INTERNATIONAL SUPPORT
- Initially allow remote ordering within the same
  marketplace country.
- Keep cross-border ordering disabled by default.
- Design the architecture to support international
  recipient delivery in a future phase.
```

### ৪. আরও একটি গুরুত্বপূর্ণ বিষয়

আপনার Marketplace-এ Checkout-এর সময় দুটি Option রাখবেন:

**Option 1: Deliver to Myself**

ক্রেতা নিজের জন্য অর্ডার করবেন।

**Option 2: Deliver to Someone Else**

ক্রেতা অন্য কারও জন্য অর্ডার করবেন।

এই দ্বিতীয় Option নির্বাচন করলে Recipient-এর নাম, ফোন নম্বর এবং Delivery Address দিতে হবে।

আমার সুপারিশ হলো, এই সিস্টেমটি শুধু খাবারের জন্য নয়—ভবিষ্যতে Grocery, Medicine (প্রযোজ্য নিয়ম মেনে), Electronics, Fashion, Gifts এবং অন্যান্য Product-এর ক্ষেত্রেও ব্যবহারযোগ্য করে তৈরি করবেন।

এতে আপনার Marketplace একই সঙ্গে Local Ordering এবং Remote Ordering—দুই ধরনের ব্যবসা পরিচালনা করতে পারবে।

# Source assistant message 427

হ্যাঁ, বুঝেছি। আপনি জানতে চাচ্ছেন, আমার মতে ইউজার এক্সপেরিয়েন্স আরও ভালো করতে কোন জিনিসগুলো অ্যাড করলে ভালো হবে। আচ্ছা, একটু সময় দিন। উম... আমার মতে, ইউজার এক্সপেরিয়েন্স বাড়ানোর জন্য তিনটা জিনিস খুব কাজে দেবে। এক, স্মার্ট সার্চ উইথ ফিল্টার আর সাজেশন, যেন কাস্টমার নাম না জেনেও জিনিস পেয়ে যায়। দুই, রিয়েল-টাইম অর্ডার আপডেট ম্যাপসহ। তিন, ট্রাস্ট আর সেফটি সিগনাল, মানে ভেরিফায়েড ভেন্ডর ব্যাজ, স্পষ্ট রিফান্ড পলিসি, আর ডেলিভারি টাইমের সঠিক তথ্য। বিক্রেতার জন্য অটো প্রোডাক্ট বর্ণনা সাজেশন, কিন্তু দাম বা পেমেন্ট সেটিংস-এ AI কখনো নিজে থেকে ছুঁবে না। রাইডারের জন্য সহজ ন্যাভিগেশন, ভয়েস নোটিফিকেশন, আর স্পষ্ট পেমেন্ট স্ট্যাটাস। অ্যাডমিনের জন্য রিয়েল-টাইম অ্যানালিটিক্স, ফ্রড অ্যালার্ট, আর কমপ্লায়েন্স রিমাইন্ডার থাকলে পুরো সিস্টেমটাই আরও স্মুথ হবে। আর আপনার প্ল্যাটফর্মে যদি একটা ছোট হেল্প বট থাকে, সেটা শুধু সাহায্য করবে, কোনো সিদ্ধান্ত নেবে না। এতে মানুষ কনফিউজড হবে না, আর সিস্টেমও বেশি বিশ্বাসযোগ্য লাগবে। কি এইগুলোর মধ্যে কোনোটা আপনার অগ্রাধিকার তালিকায় আছে? থাকলে সেটার ওপর ফোকাস করে আমরা পরের ডকুমেন্টটা বানাতে পারি।

# Source assistant message 430

আপনার পছন্দ করা সবগুলো ফিচারই Marketplace-এর মূল Development Specification-এর সঙ্গে যুক্ত করার জন্য নিচে একটি নতুন মডিউল তৈরি করছি।

আমার পরামর্শ, এগুলোকে শুধু আলাদা কিছু Feature হিসেবে না রেখে **AI-Powered Smart Marketplace & Premium User Experience System** হিসেবে তৈরি করবেন।

এতে Customer, Vendor, Rider এবং Admin প্রত্যেকের জন্য আলাদা AI সুবিধা থাকবে। পাশাপাশি AI নিজে থেকে কিছু কাজ করতে পারবে, যাতে ব্যবহারকারীর অভিজ্ঞতা সহজ হয়।

## ১. Customer Experience Enhancement

কাস্টমারদের জন্য যুক্ত করবেন:

1. **AI Smart Search:** পণ্যের নাম না জানলেও সাধারণ ভাষায় সার্চ করে পণ্য খুঁজে পাবে।
2. **Smart Filters:** দাম, রেটিং, দূরত্ব, ডেলিভারি সময় ও ক্যাটাগরি অনুযায়ী ফিল্টার।
3. **Personalized Recommendations:** কাস্টমারের পছন্দ ও পূর্বের কেনাকাটা অনুযায়ী পণ্য সাজেস্ট।
4. **AI Shopping Assistant:** কাস্টমারকে পণ্য নির্বাচন, তুলনা ও কেনাকাটায় সাহায্য করবে।
5. **Voice Shopping:** কথা বলেই পণ্য সার্চ ও অর্ডার করার সুবিধা।
6. **Live Order Tracking:** ম্যাপে Rider-এর অবস্থান ও অর্ডারের অগ্রগতি দেখা।
7. **Smart Notifications:** অর্ডার, অফার, ডেলিভারি ও গুরুত্বপূর্ণ আপডেট।
8. **Trust & Safety:** Verified Vendor Badge, Customer Reviews, পরিষ্কার Refund Policy এবং নির্ভরযোগ্য Delivery ETA।
9. **AI Complaint Assistant:** কাস্টমারের অভিযোগ বুঝে সঠিক বিভাগে পাঠাবে।
10. **Easy Reordering:** আগের অর্ডার থেকে সহজে আবার অর্ডার করা যাবে।

## ২. Vendor AI Assistant

Vendor-এর জন্য:

- AI Product Description Generator।
- Product Image Enhancement Assistant।
- Smart Inventory Prediction।
- Low Stock Alert।
- Sales Forecasting।
- AI Pricing Suggestions।
- Best-selling Product Analysis।
- Customer Demand Analysis।
- Automated Order Management।
- AI Business Performance Report।

AI অনুমোদিত সীমার মধ্যে পণ্যের তথ্য তৈরি ও অর্ডার ব্যবস্থাপনা করতে পারবে। কিন্তু Vendor-এর অনুমতি ছাড়া দাম, পেমেন্ট, Refund বা Settlement পরিবর্তন করতে পারবে না।

## ৩. Rider AI Assistant

Rider-এর জন্য:

- AI Smart Route Optimization।
- Traffic-aware Navigation।
- Multiple Delivery Route Planning।
- Voice Navigation।
- Automatic Delivery Priority।
- Customer Communication Assistant।
- Smart Delivery OTP Verification।
- Daily Earnings Dashboard।
- Delivery Performance Analysis।
- Emergency/SOS Support।

Rider যেন কম সময়ে, নিরাপদে এবং কম দূরত্বে ডেলিভারি সম্পন্ন করতে পারে, সেটাই হবে মূল লক্ষ্য।

## ৪. Admin AI Intelligence System

Admin-এর জন্য:

- Real-time Business Analytics।
- AI Fraud Detection Alerts।
- Fake Order Pattern Analysis।
- Vendor Performance Monitoring।
- Rider Performance Monitoring।
- Sales Prediction।
- Customer Behavior Analytics।
- Automatic Compliance Reminders।
- Suspicious Activity Detection।
- AI-generated Daily, Weekly ও Monthly Reports।

আপনার Main Super Admin পুরো Marketplace-এর Global Report দেখতে পারবেন। অন্য Admin শুধু নিজের অনুমোদিত Country, City অথবা Zone-এর তথ্য দেখতে পারবেন।

## ৫. AI Automation & Permission System

এটি অত্যন্ত গুরুত্বপূর্ণ।

AI শুধু পরামর্শ দেবে না, অনুমোদিত কাজ নিজে থেকেও করতে পারবে।

উদাহরণ:

| কাজ | AI-এর ক্ষমতা |
|---|---|
| Product Description তৈরি | নিজে করতে পারবে |
| Customer প্রশ্নের উত্তর | নিজে দিতে পারবে |
| Order Status জানানো | নিজে করতে পারবে |
| Low Stock Alert | নিজে পাঠাতে পারবে |
| Delivery Route পরিবর্তনের প্রস্তাব | দিতে পারবে |
| Fraudulent Order শনাক্ত | Hold করতে পারবে |
| Refund প্রদান | অনুমোদন লাগবে |
| Vendor Payment | অনুমোদন লাগবে |
| Admin Permission পরিবর্তন | Super Admin অনুমোদন লাগবে |
| Database পরিবর্তন | কঠোর অনুমোদন ও Audit প্রয়োজন |

প্রতিটি AI Agent-এর আলাদা Identity, API Permission এবং Activity Log থাকতে হবে।

## ৬. Smart Notification & Communication System

আরেকটি গুরুত্বপূর্ণ বিষয় যুক্ত করবেন।

- Email Notification।
- SMS Notification।
- In-App Notification।
- Push Notification।
- WhatsApp Notification (সমর্থিত API ও সম্মতি অনুযায়ী)।
- Order Status Updates।
- Delivery Reminders।
- Personalized Offers।
- Important Security Alerts।

কাস্টমার নিজের Notification Preference নিয়ন্ত্রণ করতে পারবে।

## ৭. Premium User Experience

আমার পক্ষ থেকে আরও কিছু ফিচার যোগ করার পরামর্শ:

**A. Smart Checkout**
- এক পৃষ্ঠায় সহজ Checkout।
- Saved Delivery Address।
- Multiple Payment Options।
- Automatic Delivery Charge Calculation।
- Coupon Validation।

**B. Loyalty & Rewards**
- Reward Points।
- Cashback System।
- Referral Program।
- Membership Levels।
- Customer Loyalty Rewards।

**C. Customer Protection**
- Verified Customer Reviews।
- Order Dispute Management।
- Refund Tracking।
- Vendor Reliability Score।
- Transparent Pricing।

**D. Accessibility**
- বাংলা ও ইংরেজি ভাষা।
- Mobile-first Responsive Design।
- Voice Assistance।
- সহজ Navigation।
- Accessibility-friendly Interface।

## ৮. Developer-এর জন্য Final Implementation Prompt

নিচের Prompt-টি আপনার মূল Marketplace Development Specification-এর সঙ্গে যুক্ত করবেন।

```text
MODULE: AI-POWERED SMART MARKETPLACE
AND PREMIUM USER EXPERIENCE SYSTEM

OBJECTIVE:
Build an intelligent, automated, scalable marketplace
that improves the experience of customers, vendors,
riders, and administrators.

1. CUSTOMER AI:
- AI shopping assistant.
- Natural language smart search.
- Advanced product filtering.
- Personalized recommendations.
- Product comparison.
- Voice shopping.
- Real-time order tracking.
- AI complaint assistant.
- Smart notifications.
- One-click reordering.

2. VENDOR AI:
- AI product description generation.
- Product image enhancement.
- Inventory forecasting.
- Low-stock alerts.
- Sales forecasting.
- Pricing recommendations.
- Customer demand analysis.
- Automated order assistance.
- Business analytics.

3. RIDER AI:
- Smart route optimization.
- Traffic-aware navigation.
- Multiple delivery optimization.
- Voice navigation.
- Delivery priority recommendations.
- Customer communication assistance.
- Earnings analytics.
- Emergency SOS support.

4. ADMIN AI:
- Real-time business analytics.
- Fraud detection alerts.
- Fake order pattern recognition.
- Vendor performance monitoring.
- Rider performance monitoring.
- Sales forecasting.
- Customer behavior analytics.
- Compliance reminders.
- Automated business reports.
- Suspicious activity detection.

5. AI AUTOMATION:
Allow AI agents to independently execute
pre-approved, low-risk operations.

Require human authorization for:
- Refunds.
- Financial settlements.
- Payment modifications.
- Role and permission changes.
- Sensitive account operations.
- Critical database modifications.

6. SECURITY:
- Every AI agent must have a unique identity.
- Enforce server-side RBAC.
- Apply geographical access restrictions.
- Follow least-privilege principles.
- Maintain complete AI activity logs.
- Prevent unauthorized tool execution.
- Validate every sensitive operation.
- Implement human approval workflows.
- Never expose sensitive customer information.

7. NOTIFICATION SYSTEM:
- Email notifications.
- SMS notifications.
- Push notifications.
- In-app notifications.
- WhatsApp integration where supported.
- Personalized notifications.
- Order and delivery alerts.

8. CUSTOMER EXPERIENCE:
- Smart checkout.
- Multiple payment options.
- Saved delivery addresses.
- Automatic delivery fee calculation.
- Loyalty rewards.
- Cashback.
- Referral program.
- Verified reviews.
- Dispute management.
- Refund tracking.

9. ACCESSIBILITY:
- Bengali and English language support.
- Mobile-first responsive design.
- Accessible navigation.
- Voice assistance.
- Fast-loading interfaces.
- Accessibility standards compliance.

10. ADMINISTRATIVE CONTROL:
- Global Super Admin controls all AI agents.
- Country Admin controls authorized country operations.
- City Admin controls authorized city operations.
- Zone Admin controls authorized zone operations.
- AI reports must respect geographical permissions.

11. PERFORMANCE:
- Asynchronous AI processing.
- Background job queues.
- API caching.
- Database query optimization.
- AI usage monitoring.
- Error handling and retry mechanisms.
- Graceful fallback when AI services fail.

12. TESTING:
- Test every role independently.
- Test AI permission restrictions.
- Test unauthorized AI actions.
- Test customer privacy.
- Test concurrent orders.
- Test system failure recovery.
- Perform security and performance testing.

IMPORTANT:
AI must improve user experience without compromising
security, privacy, financial integrity, or system stability.

All AI features must be modular and independently
maintainable.

Do not implement unnecessary features that slow down
the marketplace or create security vulnerabilities.
```

## ৯. আমার বিশেষ পরামর্শ: সবকিছু একসঙ্গে চালু করবেন না

আপনার Marketplace অনেক বড় হচ্ছে। তাই ধাপে ধাপে বাস্তবায়ন করা ভালো।

| Phase | Development Priority |
|---|---|
| Phase 1 | Authentication, Security, RBAC, Geofencing |
| Phase 2 | Customer, Vendor, Rider Dashboard |
| Phase 3 | Order Management ও Fraud Prevention |
| Phase 4 | AI Customer Assistant ও Smart Search |
| Phase 5 | Vendor AI ও Rider AI |
| Phase 6 | Admin AI ও Business Analytics |
| Phase 7 | Loyalty, Rewards ও Advanced Automation |
| Phase 8 | Performance Optimization ও Security Audit |

**সবচেয়ে গুরুত্বপূর্ণ একটি নির্দেশনা:** ডেভেলপারকে বলবেন, কোনো নতুন AI Feature যেন আপনার আগের Security Architecture, Multi-Country System, Location Verification, Remote Ordering এবং Fraud Prevention System-এর সঙ্গে সংঘর্ষ তৈরি না করে।

আপনার লক্ষ্য হওয়া উচিত এমন একটি Marketplace তৈরি করা, যেখানে Customer সহজে কেনাকাটা করবে, Vendor সহজে ব্যবসা পরিচালনা করবে, Rider সহজে ডেলিভারি করবে এবং আপনি একটি Global Super Admin Panel থেকে সম্পূর্ণ ব্যবসা নিয়ন্ত্রণ করতে পারবেন।

আর একটি বিষয়: এগুলো এখন Developer Specification-এর জন্য প্রস্তুত করা হয়েছে; বাস্তবে যুক্ত ও কার্যকর হয়েছে কি না, তা কোডিং, Integration এবং Acceptance Testing-এর মাধ্যমে নিশ্চিত করতে হবে।