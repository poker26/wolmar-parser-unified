using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;

namespace MeshokParser.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SimpleProxyController : ControllerBase
    {
        private readonly HttpClient _httpClient;
        private readonly string _chromeDebugUrl = "http://localhost:9222";

        public SimpleProxyController(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        [HttpGet("fetch")]
        public async Task<IActionResult> FetchUrl([FromQuery] string url)
        {
            if (string.IsNullOrEmpty(url))
            {
                return BadRequest("URL parameter is required");
            }

            try
            {
                // Получаем список открытых вкладок
                var tabsResponse = await _httpClient.GetAsync($"{_chromeDebugUrl}/json");
                var tabsJson = await tabsResponse.Content.ReadAsStringAsync();
                var tabs = JsonSerializer.Deserialize<dynamic[]>(tabsJson);

                if (tabs == null || tabs.Length == 0)
                {
                    return StatusCode(500, "No Chrome tabs available");
                }

                // Используем первую вкладку
                var tab = tabs[0];
                var tabId = tab.GetProperty("id").GetString();
                var webSocketUrl = tab.GetProperty("webSocketDebuggerUrl").GetString();

                // Навигируем к URL через простой HTTP запрос
                var navigateUrl = $"{_chromeDebugUrl}/json/runtime/evaluate";
                var navigateCommand = new
                {
                    id = 1,
                    method = "Page.navigate",
                    @params = new
                    {
                        url = url
                    }
                };

                var json = JsonSerializer.Serialize(navigateCommand);
                var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");

                var response = await _httpClient.PostAsync(navigateUrl, content);
                
                if (!response.IsSuccessStatusCode)
                {
                    return StatusCode(500, $"Failed to navigate: {response.StatusCode}");
                }

                // Ждем загрузки
                await Task.Delay(5000);

                // Получаем HTML
                var htmlCommand = new
                {
                    id = 2,
                    method = "Runtime.evaluate",
                    @params = new
                    {
                        expression = "document.documentElement.outerHTML"
                    }
                };

                var htmlJson = JsonSerializer.Serialize(htmlCommand);
                var htmlContent = new StringContent(htmlJson, System.Text.Encoding.UTF8, "application/json");

                var htmlResponse = await _httpClient.PostAsync(navigateUrl, htmlContent);
                var htmlResult = await htmlResponse.Content.ReadAsStringAsync();

                return Ok(new
                {
                    success = true,
                    url = url,
                    html = htmlResult,
                    timestamp = System.DateTime.UtcNow
                });
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }
    }
}
