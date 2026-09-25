using System_ApiTest.Domain.Entities;

namespace System_ApiTest.Application.Services
{
    /// <summary>
    /// The starting training set for Sentimentnaivebayes: short hand-labelled catering
    /// reviews in English, Tagalog and Taglish, roughly balanced across the three classes.
    ///
    /// It exists so the model can read a review on day one, before any real review has been
    /// labelled. Real reviews Gemini has labelled are added on top (see
    /// Sentimentservice.TrainingExamplesAsync), so as the business collects reviews the
    /// model learns more from its own customers than from this list.
    ///
    /// Neutral matters as much as the other two: without "okay lang" and plain factual
    /// reviews, every review would be forced into Positive or Negative. Mixed reviews
    /// ("masarap pero late") are labelled Neutral on purpose.
    ///
    /// Editing: add lines freely; keep each one something a real customer might write.
    /// </summary>
    public static class Sentimentseeds
    {
        public static readonly IReadOnlyList<Sentimentnaivebayes.Example> All = Build();

        private static IReadOnlyList<Sentimentnaivebayes.Example> Build()
        {
            var positive = new[]
            {
                "The food was delicious and the staff were very accommodating.",
                "Masarap ang pagkain at ang babait ng mga staff.",
                "Sulit na sulit ang bayad, busog lahat ng bisita.",
                "Everything arrived on time and the setup was beautiful.",
                "Super sarap ng lechon, ubos agad!",
                "Thank you for making our wedding perfect.",
                "Salamat po sa masarap na handaan, babalik kami ulit.",
                "Highly recommended, the servers were polite and professional.",
                "Ang ganda ng setup ng tables, parang hotel.",
                "Our guests kept asking who the caterer was. Great job!",
                "Very organized team, walang naging problema.",
                "Hindi kami nagsisi, ang sarap ng pancit at kare-kare.",
                "Fresh and hot food, generous servings.",
                "Maraming salamat sa maayos na serbisyo!",
                "The kids loved the spaghetti and the chocolate fountain.",
                "Bongga ang handa, nag-enjoy lahat.",
                "On time dumating, maayos ang delivery, masarap pa.",
                "Friendly staff and the price was worth it.",
                "Napakasarap ng menudo, parang luto ni lola.",
                "Five stars, will book again for our next party.",
                "Smooth ang buong event, wala kaming inalala.",
                "The owner was very helpful and answered all our questions quickly.",
                "Malinis ang mga plato at utensils, maayos ang presentation.",
                "Nakakabusog at masarap, sulit sa presyo.",
                "Excellent service from start to finish.",
                "Very satisfied, the menu was exactly what we wanted.",
                "Ang bait ng mga waiter, maasikaso sa mga bisita.",
                "Lovely buffet setup and tasty desserts.",
                "Perfect for our debut, salamat po!",
                "The chairs and tables were clean and complete.",
                "Galante sa servings, may natira pa kami para iuwi.",
                "Punctual crew and they cleaned up after the event.",
                "Na-impress ang mga bisita namin sa pagkain.",
                "Masaya ang lahat, hindi kami nagkamali sa pagpili.",
                "Good food, good service, good price.",
                "Mahusay ang team, sobrang professional.",
                "We were happy with everything, thank you!",
                "Recommended talaga, lalo na yung kare-kare.",
                "The event went smoothly and the food was amazing.",
                "Sarap ng dessert at ang ganda ng presentation.",
                "Nothing to complain about, everything was great.",
                "Worth every peso, sobrang sulit.",
            };

            var negative = new[]
            {
                "The food arrived cold and the rice was undercooked.",
                "Nahuli ng dalawang oras ang delivery, gutom na ang mga bisita.",
                "Kulang ang pagkain, hindi umabot sa lahat ng bisita.",
                "The staff were rude when we asked for more plates.",
                "Maalat ang adobo at matabang ang pancit.",
                "Overpriced for such small servings.",
                "Panis na yung spaghetti pagdating.",
                "Several chairs were broken and the tablecloths were dirty.",
                "Hindi masarap ang pagkain, sayang ang bayad.",
                "We were disappointed, the menu was not what we ordered.",
                "Sobrang bagal ng serbisyo, naghintay kami ng matagal.",
                "The crew arrived late and the setup was messy.",
                "Walang lasa ang sabaw at hilaw pa ang manok.",
                "Nadismaya kami, ang mahal pero pangit ang serbisyo.",
                "Missing items in our rental order and no one answered our calls.",
                "The lechon was burnt and too salty.",
                "Bastos ang isang waiter sa mga bisita namin.",
                "Terrible experience, I want a refund.",
                "Kulang ang utensils at plates, nakakahiya sa bisita.",
                "The dessert was stale and the drinks were warm.",
                "Hindi dumating ang chocolate fountain na binayaran namin.",
                "Poor communication, they changed the menu without telling us.",
                "Sira ang ilang mesa at madumi ang mga upuan.",
                "Worst catering we ever hired.",
                "Malamig na ang pagkain nung sinerve.",
                "The servers disappeared halfway through the event.",
                "Ang tagal bago nila ibinalik ang bayad namin.",
                "Not worth the price at all.",
                "Hindi maayos ang setup, magulo ang buffet table.",
                "Too few servers for the number of guests.",
                "Nakakadismaya, hindi na kami uulit.",
                "The rice ran out before half the guests had eaten.",
                "Unprofessional staff, they were on their phones the whole time.",
                "Mabaho ang mga linen na dineliver.",
                "Late delivery and the food was already cold.",
                "Sunog ang ilalim ng kaldereta.",
                "Never again, very bad service.",
                "Hindi masaya ang mga bisita sa pagkain.",
                "They charged us for chairs that were already broken on arrival.",
                "Pangit ang lasa at ang liit ng serving.",
            };

            var neutral = new[]
            {
                "The food was okay, nothing special.",
                "Okay lang ang pagkain, pwede na.",
                "Average service, some dishes were good and some were not.",
                "Dumating sila sa oras, pero medyo matabang ang pancit.",
                "We ordered the 100 pax package for a birthday.",
                "Kinuha namin yung package para sa binyag ng anak ko.",
                "The setup was fine but the dessert ran out early.",
                "Pwede na, sakto lang sa presyo.",
                "Decent food, nothing to rave about.",
                "Booked for our company outing last month.",
                "Masarap ang ulam pero medyo late ang dating.",
                "The venue was far so they arrived a bit later than planned, but they apologized.",
                "Standard buffet, similar to other caterers.",
                "Hindi naman masama, hindi rin sobrang sarap.",
                "We had a small family gathering of 50 guests.",
                "The chairs were rented for two days.",
                "Ayos lang, walang masyadong reklamo.",
                "Some guests liked the menu, others found it too salty.",
                "It was fine for the price.",
                "Katamtaman lang ang lasa.",
                "The staff did their job.",
                "First time namin mag-book dito.",
                "The food was good but the service was slow.",
                "Medyo mahal pero masarap naman.",
                "The package included rice, three viands, and dessert.",
                "Nothing bad, nothing great either.",
                "Sakto lang ang servings para sa amin.",
                "The delivery came on the scheduled date.",
                "Mixed feelings, the food was nice but the setup was late.",
                "We only used the rental service.",
                "Pinili namin ang Package B para sa reunion.",
                "It met our basic needs.",
                "So-so ang pagkain, okay naman ang staff.",
                "We rented tables and chairs only.",
                "Fair enough for a weekday event.",
                "Katamtaman ang pagkain, maayos naman ang serbisyo.",
                "Delivery was on time, the food was just average.",
                "Normal lang, parang ibang caterer din.",
                "Not bad, not great.",
                "Nag-order kami ng food trays para sa opisina.",
            };

            return positive.Select(t => new Sentimentnaivebayes.Example(t, TestimonialSentiment.Positive))
                .Concat(negative.Select(t => new Sentimentnaivebayes.Example(t, TestimonialSentiment.Negative)))
                .Concat(neutral.Select(t => new Sentimentnaivebayes.Example(t, TestimonialSentiment.Neutral)))
                .ToList();
        }
    }
}
