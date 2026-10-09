export function termsParagraphs(t: (en: string, mk: string) => string) {
  return [
    t(
      "Use this parking app only when it is safe. Do not interact with it while driving.",
      "Користете ја апликацијата само кога е безбедно. Не користете ја додека возите.",
    ),
    t(
      "Parking locations, prices, hours and availability can change. Check the signs where you park and follow local parking rules; the sign always takes priority. The app does not reserve spaces or collect payments. SMS payment only opens your messaging app with the number and message of Gradski Parking or POC, from their published rules. You decide whether to send it, your mobile operator charges you, and you remain responsible for paying the correct zone and for any fines.",
      "Локациите, цените, часовите и достапноста може да се променат. Проверете ги таблите каде што паркирате и почитувајте ги локалните правила; знакот секогаш има предност. Апликацијата не резервира места и не наплаќа. SMS-плаќањето само ја отвора апликацијата за пораки со бројот и пораката на Градски паркинг или ПОЦ, од нивните објавени правила. Вие одлучувате дали ќе ја испратите, мобилниот оператор ви наплаќа, а вие сте одговорни за плаќање на точната зона и за евентуални казни.",
    ),
    t(
      "Share information you believe is accurate. Do not include names, registration plates, private information or abusive content in sign details or notes. Report sign details that break these rules; reported content can be hidden and removed.",
      "Споделувајте информации за кои верувате дека се точни. Не внесувајте имиња, регистарски таблички, приватни податоци или навредлива содржина во податоците од табли или белешките. Пријавете податоци од табли што ги кршат овие правила; пријавената содржина може да се скрие и отстрани.",
    ),
    t(
      "Parking contributions and confirmed sign details are public. You allow the app to store, display and process them for the shared map. Sign photos are read on your device; the app never uploads or stores them, and deletes each photo after you check it. With your own Google Gemini or Groq API key, the photos you read are sent from your device to that provider under your account and its terms. Automatic readings can be wrong, so you confirm every detail before it is published.",
      "Придонесите за паркирање и потврдените податоци од табли се јавни. Дозволувате апликацијата да ги чува, прикажува и обработува за заедничката мапа. Сликите од табли се читаат на вашиот уред; апликацијата никогаш не ги испраќа и не ги чува, а секоја слика ја брише откако ќе ја проверите. Со ваш Google Gemini или Groq API клуч, сликите што ги читате се испраќаат од уредот до тој провајдер, под ваш профил и неговите услови. Автоматското читање може да згреши, затоа го потврдувате секој податок пред да се објави.",
    ),
    t(
      "Location is used on your device to find nearby parking and detect a stop. GPS accuracy depends on your device and surroundings. Your GPS history is not uploaded. Address searches and map/navigation requests are processed by their providers.",
      "Локацијата се користи на вашиот уред за блиски паркинзи и откривање запирање. Прецизноста на GPS зависи од уредот и околината. GPS историјата не се испраќа. Пребарувањата на адреси и барањата за мапи/навигација ги обработуваат нивните даватели.",
    ),
    t(
      "Guest contributions and points stay with this device until you create an account. Your username, contributions and points belong to your account. Save your password to sign in after reinstalling; email password reset is not available yet. Existing device accounts need to add a password in Account first. You can delete your account, sign details and reports in Privacy. Published parking locations and boundaries remain on the shared map. Contribution points have no monetary value.",
      "Придонесите и поените на гостите остануваат на овој уред додека не создадете профил. Корисничкото име, придонесите и поените ѝ припаѓаат на вашиот профил. Зачувајте ја лозинката за најава по повторна инсталација; обновување преку е-пошта сè уште нема. Постојните профили прво треба да додадат лозинка во Профил. Профилот, податоците од табли и пријавите може да ги избришете во Приватност. Објавените паркинзи и граници остануваат на мапата. Поените немаат парична вредност.",
    ),
  ];
}
